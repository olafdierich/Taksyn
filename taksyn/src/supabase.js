import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'taksyn-auth',
    },
    global: {
      fetch: (url, options) => {
        return fetch(url, { ...options, signal: AbortSignal.timeout(8000) })
      }
    }
  }
)

// Auto-recovery: track last successful auth time
// If app loads and last auth was > 7 days ago, clear stale tokens
const LAST_AUTH_KEY = 'taksyn-last-auth'
const lastAuth = localStorage.getItem(LAST_AUTH_KEY)
const sevenDays = 7 * 24 * 60 * 60 * 1000
if (lastAuth && Date.now() - parseInt(lastAuth) > sevenDays) {
  console.log('Clearing stale auth tokens')
  localStorage.removeItem('taksyn-user')
  localStorage.removeItem('taksyn-auth')
  try { indexedDB.deleteDatabase('supabase') } catch(e) {}
}
export const markAuthSuccess = () => localStorage.setItem(LAST_AUTH_KEY, Date.now().toString())
