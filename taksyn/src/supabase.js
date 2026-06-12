import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const supabaseServiceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY

export const supabaseAdmin = supabaseServiceKey && import.meta.env.VITE_SUPABASE_URL
  ? createClient(import.meta.env.VITE_SUPABASE_URL, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null
