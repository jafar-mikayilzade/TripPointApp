import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { createSessionFromUrl } from '../../lib/authDeepLink';
import { markEmailVerified } from '../../lib/emailVerification';
import { ensureProfile } from '../../lib/ensureProfile';
import { supabase } from '../../lib/supabase';

import { colors } from '../../constants/theme';
/**
 * Email təsdiq deep link: trippoint://auth/callback?...
 * "Unmatched Route" əvəzinə TripPoint ekranı göstərir və sessiyanı qurur.
 */
export default function AuthCallbackScreen() {
  const params = useLocalSearchParams();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('Email təsdiqlənir...');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const initialUrl = await Linking.getInitialURL();
        const url =
          initialUrl && initialUrl.includes('auth/callback')
            ? initialUrl
            : buildUrlFromParams(params);

        const { error } = await createSessionFromUrl(url);
        if (cancelled) {
          return;
        }

        if (error) {
          setStatus('error');
          setMessage(error);
          return;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          await ensureProfile(user);
          await markEmailVerified(user.id);
          setStatus('ok');
          setMessage('Email təsdiqləndi. TripPoint-ə yönləndirilir...');
          setTimeout(() => {
            router.replace('/(tabs)');
          }, 600);
          return;
        }

        setStatus('ok');
        setMessage('Təsdiq tamamlandı. Daxil ola bilərsiniz.');
        setTimeout(() => {
          router.replace('/auth/login');
        }, 800);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Təsdiq uğursuz oldu');
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>TripPoint</Text>
      {status === 'loading' ? <ActivityIndicator size="large" color={colors.accent} /> : null}
      <Text style={[styles.message, status === 'error' && styles.error]}>{message}</Text>
      {status === 'error' ? (
        <Pressable style={styles.button} onPress={() => router.replace('/auth/login')}>
          <Text style={styles.buttonText}>Daxil ol səhifəsinə keç</Text>
        </Pressable>
      ) : null}
    </View>
  );
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
  return qs ? `trippoint://auth/callback?${qs}` : 'trippoint://auth/callback';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brand: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 24,
  },
  message: {
    marginTop: 16,
    fontSize: 15,
    color: colors.chipText,
    textAlign: 'center',
    lineHeight: 22,
  },
  error: {
    color: colors.dangerText,
  },
  button: {
    marginTop: 24,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
  },
});
