import type { ErrorBoundaryProps } from 'expo-router';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { subscribeAuthDeepLinks } from '../lib/authDeepLink';
import {
  getEmailVerifiedAt,
  isVerificationGateEnabled,
} from '../lib/emailVerification';
import { ensureProfile, validateAuthUser } from '../lib/ensureProfile';
import { getErrorMessage } from '../lib/errors';
import { configureGoogleSignIn, signOutEverywhere } from '../lib/googleAuth';
import {
  hydratePasswordRecovery,
  isPasswordRecoveryPending,
  setPasswordRecoveryPending,
  subscribePasswordRecovery,
} from '../lib/passwordRecovery';
import { registerExpoPushToken } from '../lib/pushNotifications';
import { initSentry } from '../lib/sentry';
import { supabase } from '../lib/supabase';

import { InfoToastProvider } from '../components/InfoToastProvider';
import { BrandSplash } from '../components/BrandSplash';
import { lightColors } from '../constants/theme';
import { ThemeProvider } from '../theme/ThemeProvider';

initSentry();

const SESSION_TIMEOUT_MS = 8000;

/** Avoid "state update on unmounted" from expo-router useLinking during cold start / HMR. */
function safeReplace(href: string) {
  setTimeout(() => {
    try {
      router.replace(href as never);
    } catch {
      // navigator may not be ready yet
    }
  }, 0);
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const styles = errorStyles;
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

function RootLayoutInner() {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(isPasswordRecoveryPending());

  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  useEffect(() => {
    return subscribePasswordRecovery(setPasswordRecovery);
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
          setPasswordRecoveryPending(false);
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

      // Recovery sessiyası: tabs-a buraxma, şifrə dəyişənə qədər auth-da qal
      if (isPasswordRecoveryPending()) {
        if (isActive) {
          setSession(nextSession);
          setPasswordRecovery(true);
        }
        return;
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
        void registerExpoPushToken(user.id);
      }
    }

    async function checkSession() {
      try {
        // Recovery lock cold-start-dan əvvəl bərpa olunsun
        const recovery = await hydratePasswordRecovery();
        if (isActive && recovery) {
          setPasswordRecovery(true);
        }

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
          // Köhnə recovery sessiyası qalıbsa — tabs-a buraxma
          if (recovery && result.data.session) {
            setSession(result.data.session);
            setPasswordRecovery(true);
            safeReplace('/auth/reset-password');
            return;
          }
          // Flag qalıb, sessiya yoxdur — orphan lock-u təmizlə
          if (recovery && !result.data.session) {
            setPasswordRecoveryPending(false);
            setPasswordRecovery(false);
          }
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

        if (event === 'PASSWORD_RECOVERY') {
          setPasswordRecoveryPending(true);
          setPasswordRecovery(true);
          if (nextSession) {
            setSession(nextSession);
          }
          setIsLoading(false);
          safeReplace('/auth/reset-password');
          return;
        }

        // PKCE recovery bəzən PASSWORD_RECOVERY əvəzinə SIGNED_IN göndərir
        if (
          (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
          isPasswordRecoveryPending()
        ) {
          setPasswordRecovery(true);
          if (nextSession) {
            setSession(nextSession);
          }
          setIsLoading(false);
          if (event === 'SIGNED_IN') {
            safeReplace('/auth/reset-password');
          }
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

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || passwordRecovery) {
      return;
    }
    void registerExpoPushToken(userId);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void registerExpoPushToken(userId);
      }
    });
    return () => sub.remove();
  }, [session?.user?.id, passwordRecovery]);

  if (isLoading) {
    return <BrandSplash animateProgress />;
  }

  const showApp = !!session && !passwordRecovery;
  const showAuth = !session || passwordRecovery;

  return (
    <InfoToastProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />

        <Stack.Protected guard={showApp}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="split-bill" />
          <Stack.Screen name="feed" />
        </Stack.Protected>

        <Stack.Protected guard={showAuth}>
          <Stack.Screen name="auth" />
        </Stack.Protected>
      </Stack>
    </InfoToastProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}

const errorStyles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightColors.bg,
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: lightColors.text,
    marginBottom: 8,
  },
  errorText: {
    color: lightColors.dangerText,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: lightColors.brand,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  retryText: {
    color: lightColors.textOnAccent,
    fontWeight: '700',
  },
});
