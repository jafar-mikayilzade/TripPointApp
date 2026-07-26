import { supabase } from './supabase';

/** Fire-and-forget product event (RLS: insert own). */
export async function trackEvent(
  name: string,
  props: Record<string, unknown> = {}
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from('app_events').insert({
      user_id: user?.id ?? null,
      name,
      props,
    });
  } catch {
    // never block UX
  }
}
