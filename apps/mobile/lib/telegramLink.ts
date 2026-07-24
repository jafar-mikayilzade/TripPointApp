import Constants from 'expo-constants';
import { Linking } from 'react-native';

import { supabase } from './supabase';

const LINK_TTL_MS = 15 * 60 * 1000;

function randomLinkCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function getTelegramBotUsername(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME?.trim();
  const fromExtra = (
    Constants.expoConfig?.extra as { telegramBotUsername?: string } | undefined
  )?.telegramBotUsername?.trim();
  const raw = fromEnv || fromExtra || '';
  if (!raw) {
    return null;
  }
  return raw.replace(/^@/, '');
}

/** Creates one-time code in Supabase and opens t.me/Bot?start=CODE */
export async function startTelegramLink(): Promise<{
  opened: boolean;
  error: string | null;
}> {
  const bot = getTelegramBotUsername();
  if (!bot) {
    return {
      opened: false,
      error: 'Telegram bot username təyin edilməyib (.env / app.json)',
    };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { opened: false, error: 'Giriş lazımdır' };
  }

  // Drop expired codes for this user
  await supabase
    .from('telegram_link_codes')
    .delete()
    .eq('user_id', user.id)
    .lt('expires_at', new Date().toISOString());

  const code = randomLinkCode();
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

  const { error } = await supabase.from('telegram_link_codes').insert({
    code,
    user_id: user.id,
    expires_at: expiresAt,
  });

  if (error) {
    return { opened: false, error: error.message };
  }

  const url = `https://t.me/${bot}?start=${code}`;
  try {
    await Linking.openURL(url);
    return { opened: true, error: null };
  } catch (err) {
    return {
      opened: false,
      error: err instanceof Error ? err.message : 'Telegram açıla bilmədi',
    };
  }
}
