/**
 * Shared secret for mobile → FastAPI notify/push/telegram mirrors.
 * Must match Railway TELEGRAM_NOTIFY_SECRET (same value as X-Notify-Secret).
 * Dev: leave unset if API has no secret configured.
 */
export function getNotifySecretHeaders(): Record<string, string> {
  const secret = process.env.EXPO_PUBLIC_NOTIFY_SECRET?.trim();
  if (!secret) {
    return { 'Content-Type': 'application/json' };
  }
  return {
    'Content-Type': 'application/json',
    'X-Notify-Secret': secret,
  };
}
