import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
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
import { AUTH_CALLBACK_URL } from '../../lib/authDeepLink';
import { sendEmailVerificationLink } from '../../lib/emailVerification';
import { ensureProfile } from '../../lib/ensureProfile';
import { getErrorMessage } from '../../lib/errors';
import {
  TEXT_FORMAT_ERROR,
  getPasswordRuleStatus,
  hasDisallowedTextSymbols,
  sanitizeFullNameInput,
  validateEmail,
  validateFullName,
  validatePassword,
  validateTextWordPatterns,
} from '../../lib/formValidation';
import { signInWithGoogle } from '../../lib/googleAuth';
import { supabase } from '../../lib/supabase';

import { colors } from '../../constants/theme';

export default function RegisterScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const passwordBlockY = useRef(0);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [awaitingEmailConfirm, setAwaitingEmailConfirm] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [confirmViaOtp, setConfirmViaOtp] = useState(false);

  const passwordRules = getPasswordRuleStatus(password);
  const allPasswordRulesMet = passwordRules.every((rule) => rule.met);
  const showPasswordHints = passwordFocused;

  function validateEmailField(value: string): boolean {
    const err = validateEmail(value);
    setEmailError(err);
    return !err;
  }

  function scrollPasswordIntoView() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, passwordBlockY.current - 24),
        animated: true,
      });
    });
  }

  async function handleRegister() {
    setErrorMessage(null);

    const nameValidation = validateFullName(fullName);
    if (nameValidation) {
      setNameError(nameValidation);
      setErrorMessage(nameValidation);
      return;
    }
    setNameError(null);

    if (!validateEmailField(email)) {
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setErrorMessage(passwordError);
      setPasswordFocused(true);
      scrollPasswordIntoView();
      return;
    }

    setLoading(true);
    try {
      const trimmedEmail = email.trim();

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: AUTH_CALLBACK_URL,
        },
      });

      if (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      }

      if (!data.user) {
        setErrorMessage('Qeydiyyat tamamlanmadı. Yenidən cəhd edin.');
        return;
      }

      if (data.user.identities && data.user.identities.length === 0) {
        setErrorMessage(
          'Bu email artıq qeydiyyatdadır. Daxil olun, və ya “Şifrəni unutdum” ilə bərpa edin. Əvvəl hesabı silmisinizsə və bu xəta qalırsa, dəstəyə yazın.'
        );
        return;
      }

      // Email təsdiqi açıqdıırsa session olmur → client upsert RLS-ə düşür.
      // Profil artıq handle_new_user trigger-i ilə yaradılır.
      if (!data.session) {
        setRegisteredEmail(trimmedEmail);
        setAwaitingEmailConfirm(true);
        return;
      }

      await ensureProfile(data.user);
      router.replace('/(tabs)');
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setErrorMessage(null);

    const result = await signInWithGoogle();

    if (result.needsEmailConfirm && result.email) {
      setRegisteredEmail(result.email);
      setConfirmViaOtp(true);
      setAwaitingEmailConfirm(true);
      if (result.error) {
        setErrorMessage(result.error);
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

  async function handleResendConfirm() {
    if (!registeredEmail) {
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      if (confirmViaOtp) {
        const sent = await sendEmailVerificationLink(registeredEmail);
        if (sent.error) {
          setErrorMessage(sent.error);
        }
        return;
      }

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: registeredEmail,
        options: { emailRedirectTo: AUTH_CALLBACK_URL },
      });
      if (error) {
        setErrorMessage(getErrorMessage(error));
      }
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (awaitingEmailConfirm) {
    return (
      <View style={styles.confirmScreen}>
        <Text style={styles.title}>Emailinizi yoxlayın</Text>
        <Text style={styles.confirmBody}>
          Təsdiq linki göndərildi:{'\n'}
          <Text style={styles.confirmEmail}>{registeredEmail}</Text>
        </Text>
        <Text style={styles.confirmHint}>
          Poçtdakı linkə basın. Sonra app-ə qayıdıb daxil ola bilərsiniz.
        </Text>

        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={() => {
            void handleResendConfirm();
          }}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Linki yenidən göndər</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.replace('/auth/login')}
        >
          <Text style={styles.secondaryButtonText}>Daxil ol səhifəsinə keç</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.title}>Qeydiyyat</Text>
        <Text style={styles.subtitle}>Yeni TripPoint hesabı yaradın</Text>

        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

        <FormField
          label="Ad soyad"
          value={fullName}
          onChangeText={(text) => {
            const lettersOnly = text.replace(/[^\p{L}\s]/gu, '');
            const cleaned = sanitizeFullNameInput(text);
            if (hasDisallowedTextSymbols(text)) {
              setNameError(TEXT_FORMAT_ERROR);
            } else if (cleaned.length < lettersOnly.length) {
              setNameError(validateTextWordPatterns(lettersOnly) ?? TEXT_FORMAT_ERROR);
            } else {
              setNameError(null);
            }
            setFullName(cleaned);
          }}
          onBlur={() => setNameError(validateFullName(fullName))}
          error={nameError}
          placeholder="Adınız və soyadınız"
          autoCapitalize="words"
          returnKeyType="next"
          editable={!loading && !googleLoading}
        />

        <FormField
          label="E-poçt"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            if (emailError) {
              setEmailError(validateEmail(text));
            }
          }}
          onBlur={() => {
            if (email.trim().length > 0) {
              validateEmailField(email);
            } else {
              setEmailError(null);
            }
          }}
          error={emailError}
          placeholder="example@mail.com"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          editable={!loading && !googleLoading}
        />

        <View
          onLayout={(e) => {
            passwordBlockY.current = e.nativeEvent.layout.y;
          }}
        >
          <FormField
            label="Şifrə"
            value={password}
            onChangeText={setPassword}
            placeholder="şifrənizi yazın"
            secureTextEntry
            showPasswordToggle
            disablePasswordSuggestions
            autoCapitalize="none"
            returnKeyType="done"
            editable={!loading && !googleLoading}
            onFocus={() => {
              setPasswordFocused(true);
              setTimeout(scrollPasswordIntoView, 150);
            }}
            onBlur={() => setPasswordFocused(false)}
            belowLabel={
              showPasswordHints ? (
                <View
                  style={[
                    styles.passwordHints,
                    allPasswordRulesMet && styles.passwordHintsOk,
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
              ) : null
            }
          />
        </View>

        {!passwordFocused ? (
          <>
            <Pressable
              style={[
                styles.button,
                (loading || googleLoading || Boolean(emailError)) && styles.buttonDisabled,
              ]}
              onPress={handleRegister}
              disabled={loading || googleLoading || Boolean(emailError)}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Qeydiyyat</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>və ya</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              onPress={handleGoogleSignIn}
              disabled={googleLoading || loading}
              style={[
                styles.googleButton,
                (googleLoading || loading) && styles.buttonDisabled,
              ]}
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

            <Text style={styles.footer}>
              Artıq hesabın var?{' '}
              <Link href="/auth/login" style={styles.footerLink}>
                Daxil ol
              </Link>
            </Text>
          </>
        ) : (
          <View style={styles.passwordFocusSpacer} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },
  confirmScreen: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.surface,
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
  },
  passwordHints: {
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    gap: 4,
  },
  passwordHintsOk: {
    backgroundColor: colors.successSoft,
    borderColor: '#BBF7D0',
  },
  passwordHint: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  passwordHintUnmet: {
    color: colors.danger,
  },
  passwordHintMet: {
    color: colors.success,
  },
  passwordFocusSpacer: {
    height: 220,
  },
  confirmBody: {
    marginTop: 12,
    fontSize: 15,
    color: colors.chipText,
    lineHeight: 22,
  },
  confirmEmail: {
    fontWeight: '700',
    color: colors.text,
  },
  confirmHint: {
    marginTop: 12,
    marginBottom: 20,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.textOnAccent,
    fontSize: 15,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
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
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    elevation: 2,
  },
  googleIcon: {
    width: 20,
    height: 20,
    borderRadius: 16,
    backgroundColor: '#4285F4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleIconText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '800',
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.chipText,
  },
  footer: {
    marginTop: 20,
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color: colors.accent,
    fontWeight: '600',
  },
});
