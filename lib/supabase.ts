// Supabase client (null when not configured, in which case the app runs in guest mode only)
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

/**
 * The bearer token for our own API routes, refreshing a stale session once.
 *
 * `getSession()` reports a failed refresh through `error` while still resolving
 * with no session, so reading only `data` silently turns "your sign-in lapsed"
 * into "no token". The explicit retry matters on phones: a backgrounded tab is
 * frozen, so the automatic refresh timer may simply not have run — and every
 * caller here is a route that would otherwise answer 401 to a user who is, as
 * far as they are concerned, signed in (docs/LESSONS.md 2026-07-29).
 *
 * Returns null only when there is genuinely no usable session.
 */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (data.session?.access_token) return data.session.access_token
  if (error) console.warn('accessToken: no usable session —', error.message)
  const { data: retried, error: retryErr } = await supabase.auth.refreshSession()
  if (retryErr) console.warn('accessToken: session refresh failed —', retryErr.message)
  return retried.session?.access_token ?? null
}
