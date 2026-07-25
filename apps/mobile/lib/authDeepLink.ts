import * as Linking from 'expo-linking';
import * as QueryParams from 'expo-auth-session/build/QueryParams';

import { AUTH_CALLBACK_URL } from './authConstants';
import { markEmailVerified } from './emailVerification';
import { setPasswordRecoveryPending } from './passwordRecovery';
import { supabase } from './supabase';

export { AUTH_CALLBACK_URL };

function isAuthDeepLink(url: string): boolean {
  return url.includes('auth/callback') || url.includes('auth/reset-password');
}

function isRecoveryUrl(url: string, type: string): boolean {
  return type === 'recovery' || url.includes('auth/reset-password');
}

function normalizeAuthUrl(url: string): string {
  // Hash (#access_token=...) və query (?code=...) hər ikisini oxu
  return url.replace(/#/g, '?');
}

/**
 * Deep link URL-dən Supabase session yaradır.
 * Email confirm / password recovery:
 * - PKCE: `?code=`
 * - Implicit: `#access_token` / `?access_token` (Android hash-i tez-tez silir)
 * - token_hash: `verifyOtp` (email template / confirm səhifəsi)
 */
export async function createSessionFromUrl(url: string): Promise<{ error: string | null }> {
  if (!url || !isAuthDeepLink(url)) {
    return { error: null };
  }

  try {
    const normalized = normalizeAuthUrl(url);
    const { params, errorCode } = QueryParams.getQueryParams(normalized);

    if (errorCode) {
      return { error: String(errorCode) };
    }

    const accessToken = params.access_token;
    const refreshToken = params.refresh_token;
    const code = params.code;
    const tokenHash = params.token_hash;
    const type = String(params.type || '').toLowerCase();
    const isRecovery = isRecoveryUrl(url, type);

    // Gate BEFORE any session mutation (SIGNED_IN race)
    if (isRecovery) {
      setPasswordRecoveryPending(true);
    }

    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as 'recovery' | 'email' | 'signup' | 'invite' | 'magiclink' | 'email_change',
      });
      if (error) {
        if (isRecovery) {
          setPasswordRecoveryPending(false);
        }
        return { error: error.message };
      }
      if (isRecovery || type === 'recovery') {
        setPasswordRecoveryPending(true);
      } else {
        await markVerifiedFromSession();
      }
      return { error: null };
    }

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        // Kod artıq işlənibsə (ilk deep-link handler), mövcud sessiyanı qəbul et
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          if (isRecovery) {
            setPasswordRecoveryPending(true);
          }
          return { error: null };
        }
        if (isRecovery) {
          setPasswordRecoveryPending(false);
        }
        return { error: error.message };
      }
      if (isRecovery) {
        setPasswordRecoveryPending(true);
      } else {
        await markVerifiedFromSession();
      }
      return { error: null };
    }

    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          if (isRecovery) {
            setPasswordRecoveryPending(true);
          }
          return { error: null };
        }
        if (isRecovery) {
          setPasswordRecoveryPending(false);
        }
        return { error: error.message };
      }
      if (isRecovery) {
        setPasswordRecoveryPending(true);
      } else {
        await markVerifiedFromSession();
      }
      return { error: null };
    }

    // Token yoxdur — mövcud recovery sessiyasını qəbul et
    if (isRecovery) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        setPasswordRecoveryPending(true);
        return { error: null };
      }
      return {
        error:
          'Şifrə sıfırlama linkində token tapılmadı. Yeni link göndərin və eyni telefondan açın.',
      };
    }

    return { error: null };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Auth link işlənmədi',
    };
  }
}

async function markVerifiedFromSession() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await markEmailVerified(user.id);
  }
}

/**
 * App açılanda və yeni deep link gələndə auth callback-i dinləyir.
 */
export function subscribeAuthDeepLinks(
  onMessage?: (message: string) => void
): () => void {
  void Linking.getInitialURL().then((url) => {
    if (!url) {
      return;
    }
    void createSessionFromUrl(url).then(({ error }) => {
      if (error && onMessage) {
        onMessage(error);
      }
    });
  });

  const subscription = Linking.addEventListener('url', ({ url }) => {
    void createSessionFromUrl(url).then(({ error }) => {
      if (error && onMessage) {
        onMessage(error);
      }
    });
  });

  return () => {
    subscription.remove();
  };
}
