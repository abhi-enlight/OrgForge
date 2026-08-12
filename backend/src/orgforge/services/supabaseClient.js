import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
// Use the service role key for backend operations that need to bypass RLS (like storing secure tokens)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key';

// NOTE: This Supabase project exposes `public` (and agentforge_logs) via
// PostgREST, and the OrgForge tables live in `public`. Keep the default
// schema so REST queries resolve correctly.
export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
