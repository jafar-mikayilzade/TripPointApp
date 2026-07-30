/**
 * Optional Sentry hook. No native SDK wired yet — set EXPO_PUBLIC_SENTRY_DSN
 * later and replace with @sentry/react-native after a native rebuild.
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }
  // DSN set but SDK not installed — keep no-op (avoids crash without rebuild)
}
