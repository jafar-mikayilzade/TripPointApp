import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ErrorBanner } from '../../components/ErrorBanner';
import { FormField } from '../../components/FormField';
import { TripPointWordmark } from '../../components/TripPointWordmark';
import { AUTH_CALLBACK_URL } from '../../lib/authDeepLink';
import { sendEmailVerificationLink } from '../../lib/emailVerification';
import { ensureProfile } from '../../lib/ensureProfile';
import { getErrorMessage } from '../../lib/errors';
import { validateEmail } from '../../lib/formValidation';
import { signInWithGoogle } from '../../lib/googleAuth';
import { supabase } from '../../lib/supabase';
import type { ThemeColors } from '../../constants/theme';
import { radii, shadows } from '../../constants/theme';
import { useTheme, useThemeColors } from '../../theme/ThemeProvider';

export default function LoginScreen() {
  const colors = useThemeColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);
  const [awaitingGoogleConfirm, setAwaitingGoogleConfirm] = useState(false);
  const [googleConfirmEmail, setGoogleConfirmEmail] = useState('');

  async function handleLogin() {
    setErrorMessage(null);
    setInfoMessage(null);
    setNeedsEmailConfirm(false);

    const emailError = validateEmail(email);
    if (emailError) {
      setErrorMessage(emailError);
      return;
    }

    if (!password) {
      setErrorMessage('Şifrə xanası boş ola bilməz. Şifrənizi daxil edin.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        const raw = error.message || '';
        if (raw.includes('Email not confirmed')) {
          setNeedsEmailConfirm(true);
        }
        setErrorMessage(getErrorMessage(error));
        return;
      }

      const ensured = await ensureProfile(data.user);
      if (ensured.error) {
        setErrorMessage(`Giriş oldu, amma profil hazırlanmadı: ${ensured.error}`);
        return;
      }

      router.replace('/(tabs)');
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirm() {
    const emailError = validateEmail(email);
    if (emailError) {
      setErrorMessage(emailError);
      return;
    }

    setResendLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: AUTH_CALLBACK_URL },
      });
      if (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      }
      setInfoMessage('Təsdiq linki yenidən göndərildi. Poçtunuzu yoxlayın.');
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setResendLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    const result = await signInWithGoogle();

    if (result.needsEmailConfirm && result.email) {
      setGoogleConfirmEmail(result.email);
      setAwaitingGoogleConfirm(true);
      if (result.error) {
        setErrorMessage(result.error);
      } else {
        setInfoMessage('Təsdiq linki emailinizə göndərildi.');
      }
      setGoogleLoading(false);
      return;
    }

    if (result.error) {
      setErrorMessage(result.error);
    } else {
      router.replace('/(tabs)');
    }

    setGoogleLoading(false);
  }

  async function handleResendGoogleConfirm() {
    if (!googleConfirmEmail) {
      return;
    }
    setResendLoading(true);
    setErrorMessage(null);
    const sent = await sendEmailVerificationLink(googleConfirmEmail);
    setResendLoading(false);
    if (sent.error) {
      setErrorMessage(sent.error);
      return;
    }
    setInfoMessage('Təsdiq linki yenidən göndərildi. Poçtunuzu yoxlayın.');
  }

  if (awaitingGoogleConfirm) {
    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.title}>Emailinizi yoxlayın</Text>
          <Text style={styles.subtitle}>
            Google hesabınız üçün təsdiq linki göndərildi:{'\n'}
            <Text style={{ fontWeight: '700' }}>{googleConfirmEmail}</Text>
          </Text>
          {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
          {infoMessage ? <Text style={styles.infoText}>{infoMessage}</Text> : null}
          <Pressable
            style={[styles.button, resendLoading && styles.buttonDisabled]}
            onPress={() => {
              void handleResendGoogleConfirm();
            }}
            disabled={resendLoading}
          >
            {resendLoading ? (
              <ActivityIndicator color={colors.textOnAccent} />
            ) : (
              <Text style={styles.buttonText}>Linki yenidən göndər</Text>
            )}
          </Pressable>
          <Pressable
            style={styles.linkButton}
            onPress={() => {
              setAwaitingGoogleConfirm(false);
              setGoogleConfirmEmail('');
            }}
          >
            <Text style={styles.linkText}>Geri</Text>
          </Pressable>
        </View>
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
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TripPointWordmark size={30} showDecor style={{ marginBottom: 18 }} />
        <View style={styles.card}>
          <Text style={styles.title}>Daxil ol</Text>
          <Text style={styles.subtitle}>TripPoint ilə Azərbaycanı kəşf edin</Text>

          {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
          {infoMessage ? (
            <View style={styles.infoBanner}>
              <Text style={styles.infoText}>{infoMessage}</Text>
            </View>
          ) : null}

          <FormField
            label="E-poçt"
            leftIcon="mail-outline"
            value={email}
            onChangeText={setEmail}
            placeholder="example@mail.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            editable={!loading && !googleLoading}
          />

          <FormField
            label="Şifrə"
            leftIcon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            showPasswordToggle
            autoCapitalize="none"
            editable={!loading && !googleLoading}
          />

          <Pressable
            style={styles.forgotLink}
            onPress={() => router.push('/auth/forgot-password')}
            disabled={loading || googleLoading}
            hitSlop={8}
          >
            <Text style={styles.forgotLinkText}>Şifrəni unutmusunuz?</Text>
          </Pressable>

          <Pressable
            style={[styles.button, (loading || googleLoading) && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading || googleLoading}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnAccent} />
            ) : (
              <Text style={styles.buttonText}>Daxil ol</Text>
            )}
          </Pressable>

          {needsEmailConfirm ? (
            <Pressable
              style={[styles.resendButton, resendLoading && styles.buttonDisabled]}
              onPress={() => {
                void handleResendConfirm();
              }}
              disabled={resendLoading || loading}
            >
              {resendLoading ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Text style={styles.resendButtonText}>Təsdiq linkini yenidən göndər</Text>
              )}
            </Pressable>
          ) : null}

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>Və ya</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            onPress={handleGoogleSignIn}
            disabled={googleLoading || loading}
            style={[styles.googleButton, (googleLoading || loading) && styles.buttonDisabled]}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color="#4285F4" />
            ) : (
              <>
                <View style={styles.googleIcon}>
                  <Text style={styles.googleIconText}>G</Text>
                </View>
                <Text style={styles.googleButtonText}>Google ilə daxil ol</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>
          Hesabınız yoxdur?{' '}
          <Link href="/auth/register" style={styles.footerLink}>
            Qeydiyyatdan keçin
          </Link>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    screen: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: 20,
      backgroundColor: colors.bg,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radii.xl,
      padding: 22,
      ...shadows.card,
      borderWidth: isDark ? 1 : 0,
      borderColor: colors.border,
    },
    title: {
      fontSize: 26,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 22,
    },
    infoBanner: {
      backgroundColor: colors.successSoft,
      borderRadius: radii.sm,
      padding: 12,
      marginBottom: 12,
    },
    infoText: {
      color: colors.success,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
    },
    forgotLink: {
      alignSelf: 'flex-end',
      marginTop: -4,
      marginBottom: 8,
      paddingVertical: 4,
    },
    forgotLinkText: {
      color: colors.brand,
      fontSize: 13,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
    button: {
      backgroundColor: isDark ? colors.accent : colors.brand,
      borderRadius: radii.pill,
      paddingVertical: 15,
      alignItems: 'center',
      marginTop: 4,
    },
    resendButton: {
      marginTop: 8,
      paddingVertical: 12,
      alignItems: 'center',
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.brand,
      backgroundColor: colors.accentSoft,
    },
    resendButtonText: {
      color: colors.brand,
      fontWeight: '700',
      fontSize: 14,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: {
      color: isDark ? colors.textOnAccent : '#FFFFFF',
      fontSize: 15,
      fontWeight: '700',
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 18,
      gap: 12,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    dividerText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: radii.pill,
      paddingVertical: 14,
      backgroundColor: colors.surface,
    },
    googleIcon: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: '#4285F4',
      justifyContent: 'center',
      alignItems: 'center',
    },
    googleIconText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '800',
    },
    googleButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    footer: {
      marginTop: 20,
      textAlign: 'center',
      color: colors.textSecondary,
      fontSize: 14,
    },
    footerLink: {
      color: colors.brand,
      fontWeight: '700',
    },
    linkButton: {
      marginTop: 16,
      alignItems: 'center',
      paddingVertical: 10,
    },
    linkText: {
      color: colors.brand,
      fontWeight: '700',
      fontSize: 14,
    },
  });
}
