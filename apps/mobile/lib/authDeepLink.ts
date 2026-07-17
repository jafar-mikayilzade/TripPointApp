import * as Linking from 'expo-linking';
import * as QueryParams from 'expo-auth-session/build/QueryParams';

import { markEmailVerified } from './emailVerification';
import { supabase } from './supabase';

/** Supabase email confirm / magic link sonrası app-ə qayıdış. */
export const AUTH_CALLBACK_URL = 'trippoint://auth/callback';

/**
 * Deep link URL-dən Supabase session yaradır.
 * Email confirm linki `code` (PKCE) və ya `access_token`+`refresh_token` gətirə bilər.
 */
export async function createSessionFromUrl(url: string): Promise<{ error: string | null }> {
  if (!url || !url.includes('auth/callback')) {
    return { error: null };
  }

  try {
    // Hash (#access_token=...) və query (?code=...) hər ikisini oxu
    const normalized = url.replace(/#/g, '?');
    const { params, errorCode } = QueryParams.getQueryParams(normalized);

    if (errorCode) {
      return { error: String(errorCode) };
    }

    const accessToken = params.access_token;
    const refreshToken = params.refresh_token;
    const code = params.code;

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        return { error: error.message };
      }
      await markVerifiedFromSession();
      return { error: null };
    }

    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        return { error: error.message };
      }
      await markVerifiedFromSession();
      return { error: null };
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
 * `code` varsa `supabase.auth.exchangeCodeForSession` çağırılır.
 * @returns unsubscribe funksiyası
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
