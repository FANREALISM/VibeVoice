import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = false;

// Fail-safe check for local development
if (!isSupabaseConfigured) {
  console.warn('Supabase URL or Anon Key is missing. Please configure them in the Secrets panel.');
}

// Lazily create the real client only if actually configured — avoids pulling
// the @supabase/supabase-js runtime into the bundle while it's disabled.
let clientPromise: Promise<SupabaseClient> | null = null;
function getRealClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(supabaseUrl, supabaseAnonKey)
    );
  }
  return clientPromise;
}

// Minimal stand-in used everywhere isSupabaseConfigured is false. Callers in
// this codebase already guard on isSupabaseConfigured before touching
// `supabase`, so this stub is never actually invoked — it just needs to
// satisfy the type shape without importing the real client eagerly.
export const supabase = {} as SupabaseClient;

// If isSupabaseConfigured is ever flipped to true, callers should use
// getRealClient() instead of the `supabase` stub above.
