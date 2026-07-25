import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

/** Password recovery gate — recovery session must not open tabs until password changed. */

const STORAGE_KEY = 'trippoint.password_recovery_pending';

type Listener = (pending: boolean) => void;

let pending = false;
let hydrated = false;
const listeners = new Set<Listener>();

export function isPasswordRecoveryPending(): boolean {
  return pending;
}

export function setPasswordRecoveryPending(value: boolean): void {
  if (pending === value) {
    return;
  }
  pending = value;
  listeners.forEach((listener) => listener(pending));
  void AsyncStorage.setItem(STORAGE_KEY, value ? '1' : '0').catch(() => {
    // ignore storage errors
  });
}

/**
 * App start: restore recovery lock so a recovery session cannot open tabs
 * after a crash / cold start.
 */
export async function hydratePasswordRecovery(): Promise<boolean> {
  if (hydrated) {
    return pending;
  }
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === '1') {
      pending = true;
      listeners.forEach((listener) => listener(true));
    }
  } catch {
    // ignore
  }
  return pending;
}

export function subscribePasswordRecovery(listener: Listener): () => void {
  listeners.add(listener);
  listener(pending);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Abort recovery: clear gate AND destroy session so the user cannot enter the app.
 */
export async function abortPasswordRecovery(): Promise<void> {
  setPasswordRecoveryPending(false);
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  }
}

/** Supabase email reset link → app screen */
export const AUTH_RESET_PASSWORD_URL = 'trippoint://auth/reset-password';
