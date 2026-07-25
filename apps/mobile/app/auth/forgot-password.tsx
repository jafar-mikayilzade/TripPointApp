import { Link, router } from 'expo-router';
import { useState } from 'react';
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
import { getErrorMessage } from '../../lib/errors';
import { validateEmail } from '../../lib/formValidation';
import { AUTH_RESET_PASSWORD_URL } from '../../lib/passwordRecovery';
import { supabase } from '../../lib/supabase';

import { colors } from '../../constants/theme';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    setErrorMessage(null);

    const emailError = validateEmail(email);
    if (emailError) {
      setErrorMessage(emailError);
      return;
    }

    setLoading(true);
    try {
      // PKCE code_verifier AsyncStorage-da saxlanır — link eyni telefondan açılmalıdır
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: AUTH_RESET_PASSWORD_URL,
      });
      if (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      }
      setSent(true);
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Poçtunuzu yoxlayın</Text>
        <Text style={styles.subtitle}>
          Şifrə sıfırlama linki göndərildi:{'\n'}
          <Text style={styles.emailHighlight}>{email.trim()}</Text>
        </Text>
        <Text style={styles.subtitle}>
          Linkə bu telefondan basın — tətbiq açılacaq və yeni şifrə formu
          görünəcək. Link bir dəfəlikdir.
        </Text>

        <Pressable style={styles.button} onPress={() => router.replace('/auth/login')}>
          <Text style={styles.buttonText}>Daxil ol səhifəsinə qayıt</Text>
        </Pressable>
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
        <Text style={styles.title}>Şifrəni unutdum</Text>
        <Text style={styles.subtitle}>
          Qeydiyyat emailinizi yazın — sıfırlama linki göndərəcəyik.
        </Text>

        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

        <FormField
          label="E-poçt"
          value={email}
          onChangeText={setEmail}
          placeholder="example@mail.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!loading}
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={() => {
            void handleSubmit();
          }}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Link göndər</Text>
          )}
        </Pressable>

        <Text style={styles.footer}>
          <Link href="/auth/login" style={styles.footerLink}>
            Daxil ol səhifəsinə qayıt
          </Link>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  },
  emailHighlight: {
    fontWeight: '700',
    color: colors.text,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: colors.textOnAccent,
    fontSize: 15,
    fontWeight: '600',
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
