import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { AUTH_CALLBACK_URL } from './authConstants';
import { createSessionFromUrl } from './authDeepLink';
import {
  getEmailVerifiedAt,
  sendEmailVerificationLink,
  setVerificationGateEnabled,
} from './emailVerification';
import { ensureProfile } from './ensureProfile';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');
type GoogleResult = {
  error: string | null;
  needsEmailConfirm?: boolean;
  email?: string;
};

let googleModule: GoogleSignInModule | null | undefined;

function isNativeModulePresent(): boolean {
  if (Platform.OS === 'web') {
    return false;
  }

  if (NativeModules.RNGoogleSignin) {
    return true;
  }

  try {
    return TurboModuleRegistry.get('RNGoogleSignin') != null;
  } catch {
    return false;
  }
}

/** Native binary-də modul yoxdursa import app-i çökdürür — yalnız mövcud olanda yüklə. */
function loadGoogleSignIn(): GoogleSignInModule | null {
  if (googleModule !== undefined) {
    return googleModule;
  }

  if (!isNativeModulePresent()) {
    googleModule = null;
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-google-signin/google-signin') as GoogleSignInModule;
    if (!mod?.GoogleSignin) {
      googleModule = null;
      return null;
    }
    googleModule = mod;
    return googleModule;
  } catch {
    googleModule = null;
    return null;
  }
}

function getWebClientId(): string {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    (Constants.expoConfig?.extra?.googleWebClientId as string | undefined) ||
    ''
  );
}

function isDeveloperConfigError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as { code?: unknown; message?: unknown };
  const code = e.code != null ? String(e.code) : '';
  const message = e.message != null ? String(e.message) : '';
  return (
    code === '10' ||
    code === '12500' ||
    code === 'DEVELOPER_ERROR' ||
    /DEVELOPER_ERROR|SIGN_IN_FAILED/i.test(message)
  );
}

const NATIVE_MISSING_MSG =
  'Google Sign-In bu quraşdırılmış app-də yoxdur. Development build yenidən yığın: eas build --profile development --platform android';

/** Konfiqurasiya — bir dəfə çağırılır (root layout). */
export function configureGoogleSignIn() {
  const mod = loadGoogleSignIn();
  if (!mod) {
    if (Platform.OS !== 'web') {
      console.warn(NATIVE_MISSING_MSG);
    }
    return;
  }

  const webClientId = getWebClientId();
  if (!webClientId) {
    console.warn(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID təyin olunmayıb. Google giriş işləməyəcək.'
    );
    return;
  }

  try {
    mod.GoogleSignin.configure({
      webClientId,
      scopes: ['email', 'profile'],
      offlineAccess: false,
    });
  } catch (err) {
    console.warn('[googleAuth] configure failed', err);
    googleModule = null;
  }
}

/** Google native cache-i təmizlə — növbəti girişdə hesab seçimi açılsın. */
async function clearGoogleSession(): Promise<void> {
  const mod = loadGoogleSignIn();
  if (!mod) {
    return;
  }

  try {
    await mod.GoogleSignin.signOut();
  } catch {
    // ignore
  }

  try {
    await mod.GoogleSignin.revokeAccess();
  } catch {
    // ignore
  }
}

/** App + Google sessiyasından çıxış. */
export async function signOutEverywhere(): Promise<{ error: string | null }> {
  await clearGoogleSession();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

async function finalizeGoogleUser(): Promise<GoogleResult> {
  setVerificationGateEnabled(false);
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      await signOutEverywhere();
      return { error: 'Google hesabında email tapılmadı' };
    }

    const ensured = await ensureProfile(user);
    if (ensured.error) {
      console.warn('[googleAuth] ensureProfile', ensured.error);
      await signOutEverywhere();
      return { error: `Giriş oldu, amma profil yaradılmadı: ${ensured.error}` };
    }

    const verifiedAt =
      ensured.profile?.email_verified_at ?? (await getEmailVerifiedAt(user.id));

    if (verifiedAt) {
      return { error: null };
    }

    const email = user.email;
    await signOutEverywhere();

    const sent = await sendEmailVerificationLink(email);
    if (sent.error) {
      console.warn('[googleAuth] verification email', sent.error);
      return {
        error: `Email təsdiq linki göndərilmədi: ${sent.error}`,
        needsEmailConfirm: true,
        email,
      };
    }

    return { error: null, needsEmailConfirm: true, email };
  } finally {
    setVerificationGateEnabled(true);
  }
}

/** Play / SHA-1 uyğunsuzluğunda native Sign-In işləməyəndə brauzer OAuth. */
async function signInWithGoogleOAuth(): Promise<GoogleResult> {
  try {
    await WebBrowser.warmUpAsync();
  } catch {
    // ignore
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: AUTH_CALLBACK_URL,
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account' },
    },
  });

  if (error || !data.url) {
    return {
      error:
        error?.message ??
        'Google OAuth açılmadı. Supabase → Authentication → URL Configuration-da trippoint://auth/callback əlavə edin.',
    };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_CALLBACK_URL);
  try {
    await WebBrowser.coolDownAsync();
  } catch {
    // ignore
  }
  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { error: 'Giriş ləğv edildi' };
  }
  if (result.type !== 'success' || !('url' in result) || !result.url) {
    return { error: 'Google girişi tamamlanmadı' };
  }

  const sessionResult = await createSessionFromUrl(result.url);
  if (sessionResult.error) {
    return { error: sessionResult.error };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return {
      error:
        'Google sessiyası alınmadı. Supabase Redirect URLs siyahısına trippoint://auth/callback əlavə edin.',
    };
  }

  return finalizeGoogleUser();
}

async function signInWithGoogleNative(): Promise<GoogleResult> {
  const mod = loadGoogleSignIn();
  if (!mod) {
    return { error: NATIVE_MISSING_MSG };
  }

  const { GoogleSignin, statusCodes } = mod;
  const webClientId = getWebClientId();
  if (!webClientId) {
    return {
      error:
        'Google Web Client ID təyin olunmayıb. .env-ə EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID əlavə edin.',
    };
  }

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  try {
    await GoogleSignin.signOut();
  } catch {
    // ignore
  }

  GoogleSignin.configure({
    webClientId,
    scopes: ['email', 'profile'],
    offlineAccess: false,
  });

  const response = await GoogleSignin.signIn();

  if (response.type === 'cancelled') {
    return { error: 'Giriş ləğv edildi' };
  }

  let idToken = response.data?.idToken ?? null;

  if (!idToken) {
    try {
      const tokens = await GoogleSignin.getTokens();
      idToken = tokens.idToken;
    } catch (tokenErr) {
      console.warn('[googleAuth] getTokens failed', tokenErr);
    }
  }

  if (!idToken) {
    return signInWithGoogleOAuth();
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) {
    console.warn('[googleAuth] supabase signInWithIdToken', error);
    return signInWithGoogleOAuth();
  }

  return finalizeGoogleUser();
}

export async function signInWithGoogle(): Promise<GoogleResult> {
  try {
    // Android native Google Sign-In needs the exact signing SHA-1 in Cloud
    // Console (debug / dev-client / Play each differ). Browser OAuth only
    // needs the Web client ID and works on every build.
    if (Platform.OS !== 'ios' || !loadGoogleSignIn()) {
      return await signInWithGoogleOAuth();
    }

    try {
      return await signInWithGoogleNative();
    } catch (err: unknown) {
      const mod = loadGoogleSignIn();
      const statusCodes = mod?.statusCodes;
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';

      if (statusCodes && code === String(statusCodes.SIGN_IN_CANCELLED)) {
        return { error: 'Giriş ləğv edildi' };
      }
      if (statusCodes && code === String(statusCodes.IN_PROGRESS)) {
        return { error: 'Giriş prosesi davam edir' };
      }

      if (isDeveloperConfigError(err) || (statusCodes && code === String(statusCodes.PLAY_SERVICES_NOT_AVAILABLE))) {
        console.warn('[googleAuth] native failed, falling back to OAuth', err);
        return await signInWithGoogleOAuth();
      }

      console.warn('[googleAuth] signIn error, trying OAuth', err);
      return await signInWithGoogleOAuth();
    }
  } catch (err: unknown) {
    console.warn('[googleAuth] OAuth/native failed', err);
    const message = err instanceof Error ? err.message : 'Google girişi uğursuz oldu';
    return { error: message };
  }
}
