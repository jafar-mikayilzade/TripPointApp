import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ErrorBanner } from '../../components/ErrorBanner';
import { FormField } from '../../components/FormField';
import { createSessionFromUrl } from '../../lib/authDeepLink';
import { getErrorMessage } from '../../lib/errors';
import {
  getPasswordRuleStatus,
  validatePassword,
} from '../../lib/formValidation';
import {
  abortPasswordRecovery,
  isPasswordRecoveryPending,
  setPasswordRecoveryPending,
} from '../../lib/passwordRecovery';
import { supabase } from '../../lib/supabase';
import type { ThemeColors } from '../../constants/theme';
import { useThemeColors } from '../../theme/ThemeProvider';

const BOOT_WAIT_MS = 4500;

/**
 * Deep link: trippoint://auth/reset-password?...
 * Recovery session sonrası yeni şifrə təyini.
 * Şifrə uğurla yenilənənə qədər tabs AÇILMAMALIDIR.
 */
export default function ResetPasswordScreen() {
  const params = useLocalSearchParams();
  const linkingUrl = Linking.useLinkingURL();
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [aborting, setAborting] = useState(false);

  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const passwordRules = useMemo(() => getPasswordRuleStatus(password), [password]);
  const allRulesMet = passwordRules.every((rule) => rule.met);

  useEffect(() => {
    let cancelled = false;

    async function acceptRecoverySession(): Promise<boolean> {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) {
        return false;
      }
      // Yalnız recovery gate artıq qoyulubsa (deep link) — adi login sessiyasını qəbul etmə
      if (!isPasswordRecoveryPending()) {
        return false;
      }
      setBootError(null);
      setBootLoading(false);
      return true;
    }

    async function tryUrl(url: string | null | undefined): Promise<boolean> {
      if (!url || !url.includes('auth/reset-password')) {
        return false;
      }
      const { error } = await createSessionFromUrl(url);
      if (cancelled) {
        return false;
      }
      if (await acceptRecoverySession()) {
        return true;
      }
      if (error) {
        setBootError(error);
      }
      return false;
    }

    async function boot() {
      try {
        // 1) Expo Router params
        const fromParams = buildUrlFromParams(params);
        if (await tryUrl(fromParams)) {
          return;
        }

        // 2) Linking URL
        if (await tryUrl(linkingUrl)) {
          return;
        }
        const initialUrl = await Linking.getInitialURL();
        if (await tryUrl(initialUrl)) {
          return;
        }

        // 3) Deep-link handler artıq recovery sessiyası qurub ola bilər
        if (await acceptRecoverySession()) {
          return;
        }

        // 4) Deep link bir az gec gələ bilər — gözlə
        const deadline = Date.now() + BOOT_WAIT_MS;
        while (!cancelled && Date.now() < deadline) {
          await sleep(400);
          if (await acceptRecoverySession()) {
            return;
          }
          const latest = Linking.getLinkingURL();
          if (latest && (await tryUrl(latest))) {
            return;
          }
        }

        if (cancelled) {
          return;
        }

        await abortPasswordRecovery();
        if (cancelled) {
          return;
        }
        setBootError(
          'Şifrə sıfırlama linki işlənmədi. Yeni link göndərin və eyni telefondan açın (link bir dəfəlikdir).'
        );
        setBootLoading(false);
      } catch (err) {
        if (cancelled) {
          return;
        }
        await abortPasswordRecovery();
        if (cancelled) {
          return;
        }
        setBootError(err instanceof Error ? err.message : 'Link işlənmədi');
        setBootLoading(false);
      }
    }

    void boot();

    const sub = Linking.addEventListener('url', ({ url }) => {
      void tryUrl(url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [params, linkingUrl]);

  async function leaveRecovery(to: '/auth/forgot-password' | '/auth/login') {
    setAborting(true);
    try {
      await abortPasswordRecovery();
      router.replace(to);
    } finally {
      setAborting(false);
    }
  }

  async function handleSave() {
    setErrorMessage(null);

    const passwordError = validatePassword(password);
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }
    if (password !== confirm) {
      setErrorMessage('Şifrələr eyni deyil.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      }
      setPasswordRecoveryPending(false);
      setDone(true);
      setTimeout(() => {
        router.replace('/(tabs)');
      }, 700);
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (bootLoading || aborting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.bootText}>
          {aborting ? 'Çıxılır...' : 'Şifrə sıfırlama hazırlanır...'}
        </Text>
      </View>
    );
  }

  if (bootError) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Link işləmədi</Text>
        <Text style={styles.subtitle}>{bootError}</Text>
        <Pressable
          style={styles.button}
          onPress={() => {
            void leaveRecovery('/auth/forgot-password');
          }}
        >
          <Text style={styles.buttonText}>Yenidən cəhd et</Text>
        </Pressable>
        <Pressable
          style={styles.linkButton}
          onPress={() => {
            void leaveRecovery('/auth/login');
          }}
        >
          <Text style={styles.linkText}>Daxil ol</Text>
        </Pressable>
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Şifrə yeniləndi</Text>
        <Text style={styles.subtitle}>TripPoint-ə yönləndirilir...</Text>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Yeni şifrə</Text>
        <Text style={styles.subtitle}>Hesabınız üçün yeni şifrə təyin edin.</Text>

        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

        <FormField
          label="Yeni şifrə"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          showPasswordToggle
          autoCapitalize="none"
          editable={!loading}
          onFocus={() => setPasswordFocused(true)}
          onBlur={() => setPasswordFocused(false)}
        />

        {passwordFocused || password.length > 0 ? (
          <View
            style={[
              styles.passwordHints,
              allRulesMet && styles.passwordHintsOk,
            ]}
          >
            {passwordRules.map((rule) => (
              <Text
                key={rule.id}
                style={[
                  styles.passwordHint,
                  rule.met ? styles.passwordHintMet : styles.passwordHintUnmet,
                ]}
              >
                {rule.met ? '✓' : '•'} {rule.label}
              </Text>
            ))}
          </View>
        ) : null}

        <FormField
          label="Şifrəni təkrarlayın"
          value={confirm}
          onChangeText={setConfirm}
          placeholder="••••••••"
          secureTextEntry
          showPasswordToggle
          autoCapitalize="none"
          editable={!loading}
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={() => {
            void handleSave();
          }}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.textOnAccent} />
          ) : (
            <Text style={styles.buttonText}>Şifrəni yadda saxla</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.linkButton}
          onPress={() => {
            void leaveRecovery('/auth/login');
          }}
        >
          <Text style={styles.linkText}>Ləğv et / Daxil ol</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrlFromParams(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value) {
      query.set(key, value);
    } else if (Array.isArray(value) && value[0]) {
      query.set(key, value[0]);
    }
  }
  const qs = query.toString();
  return qs ? `trippoint://auth/reset-password?${qs}` : 'trippoint://auth/reset-password';
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      backgroundColor: colors.bg,
    },
    bootText: {
      marginTop: 16,
      color: colors.textSecondary,
      fontSize: 14,
    },
    container: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: 24,
      backgroundColor: colors.bg,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 24,
      lineHeight: 20,
      textAlign: 'center',
    },
    button: {
      backgroundColor: colors.accent,
      borderRadius: 16,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 8,
      paddingHorizontal: 18,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: {
      color: colors.textOnAccent,
      fontSize: 15,
      fontWeight: '600',
    },
    linkButton: {
      marginTop: 16,
      paddingVertical: 10,
    },
    linkText: {
      color: colors.accent,
      fontWeight: '700',
      fontSize: 14,
    },
    passwordHints: {
      marginTop: -4,
      marginBottom: 12,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
      gap: 4,
    },
    passwordHintsOk: {
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
    },
    passwordHint: {
      fontSize: 12,
      fontWeight: '600',
    },
    passwordHintUnmet: {
      color: colors.textMuted,
    },
    passwordHintMet: {
      color: colors.success,
    },
  });
}
