import { supabase } from './supabase';

/**
 * Headers for mobile → FastAPI calls that act on behalf of the signed-in user.
 * Uses the Supabase session token so no server secret ships inside the bundle.
 */
export async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token?.trim();
  if (!token) {
    return null;
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}
