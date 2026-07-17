import type { User } from '@supabase/supabase-js';

import type { Profile } from '../types/database';
import { isGoogleOnlyUser, markEmailVerified } from './emailVerification';
import { supabase } from './supabase';

/** Auth user metadata-dan profil sahələrini çıxarır (email + Google). */
export function profileFieldsFromUser(user: User) {
  const meta = user.user_metadata ?? {};

  const fullNameCandidate = [meta.full_name, meta.name, meta.fullName].find(
    (v) => typeof v === 'string' && v.trim().length > 0
  );
  const avatarCandidate = [meta.avatar_url, meta.picture].find(
    (v) => typeof v === 'string' && v.trim().length > 0
  );

  const email = (user.email ?? '').trim().toLowerCase();

  return {
    id: user.id,
    email: email || null,
    full_name: fullNameCandidate ? String(fullNameCandidate).trim() : null,
    avatar_url: avatarCandidate ? String(avatarCandidate).trim() : null,
  };
}

/**
 * Auth istifadəçisi üçün `profiles` sətirinin mövcud olmasını təmin edir.
 */
export async function ensureProfile(user?: User | null): Promise<{
  profile: Profile | null;
  error: string | null;
  created: boolean;
}> {
  let authUser = user ?? null;

  if (!authUser) {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return {
        profile: null,
        error: error?.message ?? 'İstifadəçi sessiyası tapılmadı',
        created: false,
      };
    }
    authUser = data.user;
  }

  const { data: existing, error: fetchError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  if (fetchError) {
    return { profile: null, error: fetchError.message, created: false };
  }

  const fields = profileFieldsFromUser(authUser);

  if (existing) {
    const profile = existing as Profile;
    const needsEmailSync =
      Boolean(fields.email) &&
      (profile.email ?? '').toLowerCase() !== fields.email;
    const needsNameFill = !profile.full_name && Boolean(fields.full_name);
    const needsAvatarFill = !profile.avatar_url && Boolean(fields.avatar_url);

    if (
      !profile.email_verified_at &&
      authUser.email_confirmed_at &&
      !isGoogleOnlyUser(authUser)
    ) {
      await markEmailVerified(authUser.id);
      profile.email_verified_at = new Date().toISOString();
    }

    if (!needsEmailSync && !needsNameFill && !needsAvatarFill) {
      return { profile, error: null, created: false };
    }

    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update({
        ...(needsEmailSync ? { email: fields.email } : {}),
        ...(needsNameFill ? { full_name: fields.full_name } : {}),
        ...(needsAvatarFill ? { avatar_url: fields.avatar_url } : {}),
      })
      .eq('id', authUser.id)
      .select('*')
      .maybeSingle();

    if (updateError) {
      console.warn('[ensureProfile] update', updateError.message);
      return { profile, error: null, created: false };
    }

    return {
      profile: (updated as Profile) ?? profile,
      error: null,
      created: false,
    };
  }

  const { data: created, error: insertError } = await supabase
    .from('profiles')
    .upsert(
      {
        id: fields.id,
        email: fields.email,
        full_name: fields.full_name,
        avatar_url: fields.avatar_url,
        role: 'user',
        ...(!isGoogleOnlyUser(authUser) && authUser.email_confirmed_at
          ? { email_verified_at: new Date().toISOString() }
          : {}),
      },
      { onConflict: 'id' }
    )
    .select('*')
    .maybeSingle();

  if (insertError) {
    return { profile: null, error: insertError.message, created: false };
  }

  return { profile: created as Profile, error: null, created: true };
}

export async function validateAuthUser(
  fallbackUser?: User | null
): Promise<{ user: User | null; deleted: boolean }> {
  const { data, error } = await supabase.auth.getUser();

  if (data.user) {
    return { user: data.user, deleted: false };
  }

  const msg = (error?.message ?? '').toLowerCase();
  const deleted =
    msg.includes('user not found') ||
    msg.includes('does not exist') ||
    msg.includes('user_not_found') ||
    msg.includes('invalid claim') ||
    msg.includes('no user');

  if (deleted) {
    await supabase.auth.signOut();
    return { user: null, deleted: true };
  }

  return { user: fallbackUser ?? null, deleted: false };
}
