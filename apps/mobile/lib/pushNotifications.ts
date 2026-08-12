import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { supabase } from './supabase';

const ANDROID_CHANNEL_ID = 'trippoint-default';

/** True only when native binary includes expo-notifications. */
export function hasPushNativeModule(): boolean {
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

async function ensureAndroidChannel(
  Notifications: typeof import('expo-notifications')
): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'TripPoint',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180],
    lightColor: '#0E5837',
  });
}

/** Ask for notification permission (no-op if denied / web / missing native). */
export async function ensureNotificationPermissions(): Promise<boolean> {
  if (!hasPushNativeModule()) {
    return false;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') {
      return false;
    }
    await ensureAndroidChannel(Notifications);
    return true;
  } catch {
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
  const cleanTitle = title.trim() || 'TripPoint';
  const cleanBody = body.trim();
  if (!cleanBody || !hasPushNativeModule()) {
    return;
  }
  try {
    const ok = await ensureNotificationPermissions();
    if (!ok) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: cleanTitle,
        body: cleanBody,
        data: { source: 'local_ux', ...(data ?? {}) },
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch {
    // Permission / Expo Go without native module
  }
}

/** Register Expo push token on profile (no-op if native module missing). */
export async function registerExpoPushToken(userId: string): Promise<void> {
  if (!(await ensureNotificationPermissions())) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');

    const tokenResult = await Notifications.getExpoPushTokenAsync();
    const token = tokenResult.data?.trim();
    if (!token) {
      return;
    }

    await supabase
      .from('profiles')
      .update({ expo_push_token: token })
      .eq('id', userId);
  } catch {
    // Permission / Expo Go without native module — skip until rebuild
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
