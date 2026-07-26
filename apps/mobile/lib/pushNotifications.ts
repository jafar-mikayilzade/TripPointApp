import { Platform } from 'react-native';

import { supabase } from './supabase';

/** Register Expo push token on profile (no-op if native module missing). */
export async function registerExpoPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') {
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
    // Native module / permission — skip until rebuild with expo-notifications
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
