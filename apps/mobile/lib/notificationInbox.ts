import { supabase } from './supabase';

type InboxListener = () => void;

const listeners = new Set<InboxListener>();

export function onNotificationInboxChange(listener: InboxListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitNotificationInboxChange(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

/**
 * Live inbox: new `notifications` rows for the signed-in user.
 * Relies on supabase_realtime publication (see migration).
 */
export function subscribeNotificationInbox(handlers: {
  userId: string;
  onInsert: (row: { title?: string; body?: string | null }) => void;
}): () => void {
  const channel = supabase
    .channel(`inbox-${handlers.userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${handlers.userId}`,
      },
      (payload) => {
        const row = (payload.new ?? {}) as { title?: string; body?: string | null };
        emitNotificationInboxChange();
        handlers.onInsert(row);
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
