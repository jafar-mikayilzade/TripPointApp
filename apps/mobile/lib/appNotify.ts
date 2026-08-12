/**
 * Central UX notification helpers.
 * Immediate feedback → InfoToast; deferred welcome → AsyncStorage flag.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_WELCOME_KEY = 'trippoint.pending_welcome_toast';

export async function markPendingWelcomeToast(name?: string | null): Promise<void> {
  const label = (name || '').trim();
  const message = label
    ? `Xoş gəldiniz, ${label.split(' ')[0]}!`
    : 'Uğurlu giriş — xoş gəldiniz!';
  try {
    await AsyncStorage.setItem(PENDING_WELCOME_KEY, message);
  } catch {
    // ignore
  }
}

export async function consumePendingWelcomeToast(): Promise<string | null> {
  try {
    const msg = await AsyncStorage.getItem(PENDING_WELCOME_KEY);
    if (!msg) {
      return null;
    }
    await AsyncStorage.removeItem(PENDING_WELCOME_KEY);
    return msg;
  } catch {
    return null;
  }
}
