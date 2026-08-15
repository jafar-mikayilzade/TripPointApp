import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { getApiBaseUrl } from './apiBase';
import { getAuthHeaders } from './authHeaders';
import { supabase } from './supabase';

const ANDROID_CHANNEL_ID = 'trippoint-default';
const EXPO_PROJECT_ID = 'b06167c8-d122-4f72-850e-61100f51228d';

type NotificationsModule = typeof import('expo-notifications');

function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

/** True when expo-notifications can run (dev-client / production, not web). */
export function hasPushNativeModule(): boolean {
  if (loadNotifications()) {
    return true;
  }
  if (Platform.OS === 'web') {
    return false;
  }
  if (NativeModules.ExpoPushTokenManager || NativeModules.ExpoNotifications) {
    return true;
  }
  try {
    return TurboModuleRegistry.get('ExpoPushTokenManager') != null;
  } catch {
    return false;
  }
}

async function ensureAndroidChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  // Android 13+: the OS permission prompt appears only after a channel exists.
  // Omit `sound` so Android uses the system default — `'default'` is treated
  // as a custom file and throws "Custom sound 'default' not found".
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'TripPoint',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0E5837',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    enableVibrate: true,
    showBadge: true,
  });
}

/** Ask for notification permission (no-op if denied / web / missing native). */
export async function ensureNotificationPermissions(): Promise<boolean> {
  const Notifications = loadNotifications();
  if (!Notifications) {
    return false;
  }
  try {
    await ensureAndroidChannel(Notifications);
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      status = asked.status;
    }
    if (status !== 'granted') {
      console.warn('[push] permission status', status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[push] permission failed', err);
    return false;
  }
}

/**
 * Show a system tray / notification-center notification immediately.
 * Keeps working in foreground when setNotificationHandler allows banners.
 */
export async function presentLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const Notifications = loadNotifications();
  const cleanTitle = title.trim() || 'TripPoint';
  const cleanBody = body.trim();
  if (!cleanBody || !Notifications) {
    return;
  }
  try {
    const ok = await ensureNotificationPermissions();
    if (!ok) {
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: cleanTitle,
        body: cleanBody,
        data: { source: 'local_ux', ...(data ?? {}) },
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch (err) {
    console.warn('[push] local notification failed', err);
  }
}

async function persistToken(userId: string, token: string): Promise<boolean> {
  const base = getApiBaseUrl();
  const headers = await getAuthHeaders();
  if (base && headers) {
    try {
      const res = await fetch(`${base}/api/notify/register-token`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        return true;
      }
      console.warn('[push] register-token HTTP', res.status);
    } catch (err) {
      console.warn('[push] register-token failed', err);
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ expo_push_token: token })
    .eq('id', userId);
  if (error) {
    console.warn('[push] profile token update', error.message);
    return false;
  }
  return true;
}

let registerInFlight: Promise<string | null> | null = null;
let lastRegister: { userId: string; token: string | null; at: number } | null = null;
let loggedMissingFirebase = false;

/** Register Expo push token on profile (no-op if native module missing). */
export async function registerExpoPushToken(userId: string): Promise<string | null> {
  if (
    lastRegister &&
    lastRegister.userId === userId &&
    Date.now() - lastRegister.at < 60_000
  ) {
    return lastRegister.token;
  }
  if (registerInFlight) {
    return registerInFlight;
  }

  registerInFlight = (async () => {
    const Notifications = loadNotifications();
    if (!Notifications) {
      console.warn('[push] expo-notifications not available in this binary');
      return null;
    }

    if (!(await ensureNotificationPermissions())) {
      return null;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Constants = require('expo-constants') as typeof import('expo-constants');
      const projectId =
        Constants.easConfig?.projectId ??
        Constants.expoConfig?.extra?.eas?.projectId ??
        EXPO_PROJECT_ID;

      const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
      const token = tokenResult.data?.trim();
      if (!token) {
        console.warn('[push] empty Expo token');
        return null;
      }

      const saved = await persistToken(userId, token);
      if (!saved) {
        console.warn('[push] token not persisted');
      }
      lastRegister = { userId, token, at: Date.now() };
      return token;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/googleServicesFile|FirebaseApp is not initialized/i.test(message)) {
        if (!loggedMissingFirebase) {
          loggedMissingFirebase = true;
          console.warn(
            '[push] Android FCM yoxdur: google-services.json native build-ə düşməlidir. Metro reload kifayət etmir.'
          );
        }
      } else {
        console.warn('[push] getExpoPushTokenAsync failed', err);
      }
      lastRegister = { userId, token: null, at: Date.now() };
      return null;
    }
  })();

  try {
    return await registerInFlight;
  } finally {
    registerInFlight = null;
  }
}

export async function clearExpoPushToken(userId: string): Promise<void> {
  try {
    await supabase
      .from('profiles')
      .update({ expo_push_token: null })
      .eq('id', userId);
  } catch {
    // ignore
  }
}
