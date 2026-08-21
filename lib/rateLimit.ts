// Shared caller for the `check_rate_limit` RPC (migration 0071). SERVER-ONLY —
// both callers (app/api/report, app/api/upload-url) already run server-side.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * True if the caller is still within the given bucket/key's limit for this
 * window (and records this call toward it). Fails OPEN — returns true — when
 * the RPC itself errors (most likely migration 0071 isn't applied yet): a
 * missing rate limiter must never turn into an outage for the thing it was
 * meant to only throttle.
 */
export async function checkRateLimit(
  db: SupabaseClient,
  opts: { bucket: string; key: string; max: number; windowSeconds: number }
): Promise<boolean> {
  const { data, error } = await db.rpc('check_rate_limit', {
    p_bucket: opts.bucket,
    p_key: opts.key,
    p_max: opts.max,
    p_window_seconds: opts.windowSeconds,
  })
  if (error) return true
  return data !== false
}
