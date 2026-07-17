import type { ErrorBoundaryProps } from 'expo-router';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { subscribeAuthDeepLinks } from '../lib/authDeepLink';
import {
  getEmailVerifiedAt,
  isVerificationGateEnabled,
} from '../lib/emailVerification';
import { ensureProfile, validateAuthUser } from '../lib/ensureProfile';
import { getErrorMessage } from '../lib/errors';
import { configureGoogleSignIn, signOutEverywhere } from '../lib/googleAuth';
import { supabase } from '../lib/supabase';

const SESSION_TIMEOUT_MS = 8000;

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.loader}>
      <Text style={styles.errorTitle}>Tətbiq xətası</Text>
      <Text style={styles.errorText}>{getErrorMessage(error)}</Text>
      <Pressable style={styles.retryButton} onPress={retry}>
        <Text style={styles.retryText}>Yenidən cəhd et</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAuthDeepLinks((message) => {
      console.warn('[authDeepLink]', message);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let isActive = true;

    async function applySession(nextSession: Session | null) {
      if (!nextSession) {
        if (isActive) {
          setSession(null);
        }
        return;
      }

      const { user, deleted } = await validateAuthUser(nextSession.user);
      if (!isActive) {
        return;
      }
      if (deleted || !user) {
        setSession(null);
        return;
      }

      const ensured = await ensureProfile(user);
      if (ensured.error) {
        console.warn('[auth] ensureProfile', ensured.error);
      }

      const verifiedAt =
        ensured.profile?.email_verified_at ?? (await getEmailVerifiedAt(user.id));

      if (!verifiedAt) {
        if (!isVerificationGateEnabled()) {
          // Google idToken axını hələ davam edir — sessiyanı app-ə açma
          if (isActive) {
            setSession(null);
          }
          return;
        }

        await signOutEverywhere();
        if (isActive) {
          setSession(null);
        }
        return;
      }

      if (isActive) {
        setSession(nextSession);
      }
    }

    async function checkSession() {
      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), SESSION_TIMEOUT_MS);
          }),
        ]);

        if (!isActive) {
          return;
        }

        if (result && 'data' in result) {
          await applySession(result.data.session);
        } else {
          setSession(null);
        }
      } catch {
        if (isActive) {
          setSession(null);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void checkSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!isActive) {
          return;
        }

        if (event === 'TOKEN_REFRESHED' && nextSession) {
          setSession(nextSession);
          setIsLoading(false);
          return;
        }

        void (async () => {
          await applySession(nextSession);
          if (isActive) {
            setIsLoading(false);
          }
        })();
      }
    );

    return () => {
      isActive = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Yüklənir...</Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />

      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="split-bill" />
        <Stack.Screen name="feed" />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="auth" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  errorText: {
    color: '#B91C1C',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
  },
});
