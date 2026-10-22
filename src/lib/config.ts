export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || ''
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || ''
/** Without Supabase settings the app runs in a clearly labelled, local-only demo. */
export const IS_DEMO = !SUPABASE_URL || !SUPABASE_KEY
export const BASE = import.meta.env.BASE_URL
