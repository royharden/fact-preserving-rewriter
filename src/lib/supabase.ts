// Creating/importing this module never creates a client or starts auth. Offline Demo never calls this accessor.
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PublicBackendConfig { url?: string; anonKey?: string }
let client: SupabaseClient | null = null;
export function hasBackendConfig(config: PublicBackendConfig = {
  url: import.meta.env.VITE_SUPABASE_URL, anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
}): boolean {
  return !!config.url?.trim() && !!config.anonKey?.trim();
}
/** Call only after explicit Live mode selection/exploration; env presence alone does not establish readiness. */
export function getSupabaseClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}
