// Bearer-token auth for the storage routes. SERVER-ONLY.
//
// Uploads used to go straight from the browser to Supabase Storage, where an RLS
// policy ("you may only write into the folder named after your uid") was the
// guard. R2 has no equivalent, so that guard now lives here: every storage route
// resolves the caller's uid from their Supabase access token and BUILDS the
// object key itself. A client never gets to name the path it writes to.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export interface AuthedUser {
  uid: string
  /** Supabase client acting AS the caller, so table reads stay under RLS. */
  db: SupabaseClient
}

/** Resolve the caller from the Authorization header, or null when the token is
 *  missing, expired, or belongs to a deleted user. */
export async function authenticate(req: Request): Promise<AuthedUser | null> {
  if (!url || !anonKey) return null
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  return { uid: data.user.id, db }
}
