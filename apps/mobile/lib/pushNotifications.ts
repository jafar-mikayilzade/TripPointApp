import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { supabase } from './supabase';

/** True only when native binary includes expo-notifications. */
function hasPushNativeModule(): boolean {
  if (NativeModules.ExpoPushTokenManager || NativeModules.ExpoNotifications) {
    return true;
  }
  try {
    return TurboModuleRegistry.get('ExpoPushTokenManager') != null;
  } catch {
    return false;
  }
}

/** Register Expo push token on profile (no-op if native module missing). */
export async function registerExpoPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !hasPushNativeModule()) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      finalStatus = asked.status;
    }
    if (finalStatus !== 'granted') {
      return;
    }

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
