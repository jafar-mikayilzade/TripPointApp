import { getErrorMessage } from './errors';
import { signOutEverywhere } from './googleAuth';
import { supabase } from './supabase';

type DeleteAccountResult = { error: string | null };

function accountDeleteErrorMessage(error: {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}): string {
  const msg = [error.message, error.details, error.hint, error.code].filter(Boolean).join(' | ');
  console.warn('[deleteAccount]', msg);

  if (error.message?.includes('not_authenticated')) {
    return 'Daxil olmaq lazımdır. Yenidən giriş edin.';
  }
  if (error.message?.includes('auth_delete_failed') || error.message?.includes('profile_delete_failed')) {
    return 'Hesab tam silinmədi. Bir az sonra yenidən cəhd edin.';
  }
  if (
    error.message?.includes('Could not find the function') ||
    error.message?.includes('schema cache')
  ) {
    return 'Hesab silmə xidməti hazır deyil. Bir neçə saniyə sonra yenidən cəhd edin.';
  }
  if (error.message?.includes('permission denied')) {
    return 'Hesab silmək üçün icazə yoxdur.';
  }

  const mapped = getErrorMessage(error);
  if (mapped === 'Xəta baş verdi. Yenidən cəhd edin' && error.message) {
    return error.message;
  }
  return mapped;
}

/**
 * Auth user + profil + bütün əlaqəli məlumatları silir.
 * Eyni email ilə yenidən qeydiyyat mümkün olur.
 */
export async function deleteOwnAccount(): Promise<DeleteAccountResult> {
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user) {
      return { error: 'Daxil olmaq lazımdır' };
    }

    const { data, error } = await supabase.rpc('delete_own_account');
    if (error) {
      return { error: accountDeleteErrorMessage(error) };
    }

    if (!data || (typeof data === 'object' && 'ok' in data && !(data as { ok?: boolean }).ok)) {
      return { error: 'Hesab silinmədi. Yenidən cəhd edin.' };
    }

    await signOutEverywhere();
    return { error: null };
  } catch (err) {
    console.warn('[deleteAccount] unexpected', err);
    return { error: getErrorMessage(err) };
  }
}
