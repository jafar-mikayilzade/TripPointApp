import { useEffect, useState } from 'react';

import { fetchIsAdmin } from './adminMap';
import { supabase } from './supabase';

/** Session-dakı istifadəçinin `profiles.role === 'admin'` olub-olmadığını izləyir. */
export function useIsAdmin(): {
  isAdmin: boolean;
  loading: boolean;
} {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadRole(userId: string | undefined) {
      if (!userId) {
        if (active) {
          setIsAdmin(false);
          setLoading(false);
        }
        return;
      }

      if (active) {
        setLoading(true);
      }

      const admin = await fetchIsAdmin(userId);
      if (active) {
        setIsAdmin(admin);
        setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      void loadRole(data.session?.user?.id);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadRole(session?.user?.id);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  return { isAdmin, loading };
}
