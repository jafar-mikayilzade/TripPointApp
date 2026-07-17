import type { User } from '@supabase/supabase-js';

import { AUTH_CALLBACK_URL } from './authDeepLink';
import { supabase } from './supabase';

/** Google idToken axını bitənə qədər layout verified gate-i gözləsin. */
let verificationGateEnabled = true;

export function setVerificationGateEnabled(enabled: boolean) {
  verificationGateEnabled = enabled;
}

export function isVerificationGateEnabled() {
  return verificationGateEnabled;
}

export function isGoogleOnlyUser(user: User): boolean {
  const provider = user.app_metadata?.provider;
  if (provider === 'google') {
    return true;
  }

  const identities = user.identities ?? [];
  if (identities.length === 0) {
    return false;
  }

  const hasGoogle = identities.some((item) => item.provider === 'google');
  const hasEmail = identities.some((item) => item.provider === 'email');
  return hasGoogle && !hasEmail;
}

export async function getEmailVerifiedAt(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('email_verified_at')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return (data as { email_verified_at?: string | null }).email_verified_at ?? null;
}

export async function markEmailVerified(userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({
      email_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  return { error: error?.message ?? null };
}

/** Magic link / OTP ilə email təsdiqi göndər (istifadəçi artıq auth-da mövcuddur). */
export async function sendEmailVerificationLink(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: false,
      emailRedirectTo: AUTH_CALLBACK_URL,
    },
  });

  if (error) {
    return { error: error.message };
  }
  return { error: null };
}
