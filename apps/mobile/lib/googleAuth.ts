import Constants from 'expo-constants';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import {
  getEmailVerifiedAt,
  sendEmailVerificationLink,
  setVerificationGateEnabled,
} from './emailVerification';
import { ensureProfile } from './ensureProfile';
import { supabase } from './supabase';

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

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

function formatGoogleError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'Google girişi uğursuz oldu';
  }

  const e = err as { code?: unknown; message?: unknown };
  const code = e.code != null ? String(e.code) : '';
  const message = e.message != null ? String(e.message) : '';

  if (
    code === '10' ||
    code === 'DEVELOPER_ERROR' ||
    /DEVELOPER_ERROR/i.test(message)
  ) {
    return (
      'Google DEVELOPER_ERROR (kod 10): Google Cloud → Credentials → ' +
      'Android OAuth client (package com.jafar.TripPoint) içində bu SHA-1-lər olmalıdır: ' +
      '1) EAS/dev-client: D6:C6:10:BA:F0:1D:20:4C:66:9E:A4:33:86:3C:76:20:C1:3F:88:A1 ; ' +
      '2) Bu PC lokal debug: 7A:0A:32:D3:DA:60:30:66:FC:0F:FD:68:13:8B:0D:7C:F6:B9:37:74. ' +
      'Web client ID-ni Android client kimi istifadə etməyin. Save → 10–60 dəq → app data sil.'
    );
  }

  if (code === '12500' || /SIGN_IN_FAILED/i.test(message)) {
    return 'Google Sign-In uğursuz oldu (12500). Google Cloud-da OAuth client və SHA-1-i yoxlayın.';
  }

  if (message) {
    return code ? `${message} (${code})` : message;
  }

  return code ? `Google girişi uğursuz oldu (${code})` : 'Google girişi uğursuz oldu';
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
    // Supabase needs idToken only — offlineAccess/serverAuthCode not required
    // and can worsen DEVELOPER_ERROR with incomplete Cloud Console setup.
    mod.GoogleSignin.configure({
      webClientId,
      scopes: ['email', 'profile'],
      offlineAccess: false,
    });
    if (__DEV__) {
      console.log(
        '[googleAuth] configured webClientId=...' +
          webClientId.slice(Math.max(0, webClientId.length - 32))
      );
    }
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

export async function signInWithGoogle(): Promise<{
  error: string | null;
  needsEmailConfirm?: boolean;
  email?: string;
}> {
  const mod = loadGoogleSignIn();
  if (!mod) {
    return { error: NATIVE_MISSING_MSG };
  }

  const { GoogleSignin, statusCodes } = mod;

  try {
    const webClientId = getWebClientId();
    if (!webClientId) {
      return {
        error:
          'Google Web Client ID təyin olunmayıb. .env-ə EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID əlavə edin.',
      };
    }

    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    // Only clear local Google session — revokeAccess before sign-in can break the flow
    try {
      await GoogleSignin.signOut();
    } catch {
      // ignore
    }

    // Ensure configure is applied with current env before presenting UI
    const webClientIdFresh = getWebClientId();
    GoogleSignin.configure({
      webClientId: webClientIdFresh,
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
      return {
        error:
          'Google idToken alınmadı. configure()-də Web Client ID (tip: Web application) istifadə olunduğundan və Google Cloud-da Android client + SHA-1 olduğundan əmin olun.',
      };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });

    if (error) {
      console.warn('[googleAuth] supabase signInWithIdToken', error);
      return {
        error: `${error.message}. Supabase Dashboard → Authentication → Providers → Google: eyni Web Client ID və Client Secret aktiv olmalıdır.`,
      };
    }

    setVerificationGateEnabled(false);

    try {
      if (!data.user?.email) {
        await signOutEverywhere();
        return { error: 'Google hesabında email tapılmadı' };
      }

      const ensured = await ensureProfile(data.user);
      if (ensured.error) {
        console.warn('[googleAuth] ensureProfile', ensured.error);
        await signOutEverywhere();
        return {
          error: `Giriş oldu, amma profil yaradılmadı: ${ensured.error}`,
        };
      }

      const verifiedAt =
        ensured.profile?.email_verified_at ?? (await getEmailVerifiedAt(data.user.id));

      if (verifiedAt) {
        return { error: null };
      }

      const email = data.user.email;
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
  } catch (err: unknown) {
    console.warn('[googleAuth] signIn error', err);

    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';

    if (code === statusCodes.SIGN_IN_CANCELLED) {
      return { error: 'Giriş ləğv edildi' };
    }
    if (code === statusCodes.IN_PROGRESS) {
      return { error: 'Giriş prosesi davam edir' };
    }
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { error: 'Google Play xidmətləri mövcud deyil' };
    }

    return { error: formatGoogleError(err) };
  }
}
