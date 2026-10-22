import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { IS_DEMO, SUPABASE_KEY, SUPABASE_URL } from './config'

export const supabase: SupabaseClient | null = IS_DEMO
  ? null
  : createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'setlist.auth' },
    })
