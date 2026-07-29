// =============================================================================
// supabaseClient.js
// The single source of truth for the Supabase connection.
// Every other module imports `supabase` from here — never re-instantiate it.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// -----------------------------------------------------------------------------
// >>> REPLACE THESE TWO VALUES WITH YOUR OWN SUPABASE PROJECT CREDENTIALS <<<
// Found in: Supabase Dashboard -> Project Settings -> API
// -----------------------------------------------------------------------------
const SUPABASE_URL = 'https://naattursexlswaggslzm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_VHPRyEhb_64lUT4EX-R3og_QKEp0-hh';

if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
  // Fails loudly and visibly instead of silently breaking every request.
  console.error(
    '[supabaseClient] Missing configuration: replace SUPABASE_URL and SUPABASE_ANON_KEY in js/supabaseClient.js'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'attendance-saas-auth'
  }
});

// Convenience flag other modules can check to short-circuit with a friendly
// error instead of throwing a raw network exception.
export const isConfigured =
  SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
