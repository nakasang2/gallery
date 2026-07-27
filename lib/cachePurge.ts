// Cloudflare cache purge — SERVER-ONLY. Never import this from a component.
//
// Deleting an object from R2 does not evict it from Cloudflare's edge. R2 serves
// every object with `cache-control: max-age=14400`, so for up to four hours a
// deleted file keeps returning 200 from any colo that still holds it, to anyone
// who has the direct cdn.xibit360.art URL. Measured on production during the R2
// migration; see docs/DECISIONS.md 2026-07-27 (cache purge) and docs/R2_SETUP.md.
// That gap is what makes a copyright takedown — or a user exercising their right
// to deletion — only mostly true, so the delete routes ask Cloudflare to drop the
// cached copies right after removing the objects.
//
// Purge by PREFIX rather than by URL, for two reasons: it needs no list of keys
// (one call covers display.jpg / thumb.jpg / video / guide), and it matches
// regardless of query string, which is the only way to reach the `?v=…`
// cache-buster variants that avatars, logos and BGM are served under. Prefix
// purge is available on every plan; the free plan allows 5 such requests per
// minute per account, far above the pace of human-driven deletions.
//
// This needs a ZONE-scoped API token (Zone → Cache Purge). The R2 credentials
// are object-scoped and cannot do it, hence two extra env vars. Without them the
// app behaves exactly as it did before: deletion still works, the four-hour
// window just stays open.
import { publicUrl, publicUrlConfigured } from './publicUrl'

const zoneId = process.env.CLOUDFLARE_ZONE_ID
const token = process.env.CLOUDFLARE_PURGE_TOKEN

/** False until the zone id and purge token are set. Purging is an extra layer of
 *  protection, never a precondition — unlike the R2 vars, a missing value here
 *  must not make the delete routes answer 501. */
export const cachePurgeConfigured = Boolean(zoneId && token && publicUrlConfigured)

/** Cloudflare answers in well under a second; anything slower is not worth
 *  holding a delete request open for.
 *
 *  The delete routes await this rather than deferring it (Next's `after()`),
 *  which is safe on the function budget: even the worst case — account deletion,
 *  i.e. one RPC plus a list+delete round trip plus this timeout — lands around
 *  6s against Vercel's 10s default. Awaiting keeps the failure visible in the
 *  response and in the logs instead of vanishing into background work. */
const TIMEOUT_MS = 5000

/**
 * Ask Cloudflare to drop every cached response under a stored key prefix.
 *
 * Call this AFTER the objects are gone from R2 — purging first would let a
 * request in the gap re-populate the edge from the still-present object.
 *
 * Best-effort by design: returns false instead of throwing. The files are
 * already deleted at this point, so a failed purge is a delayed cleanup (the
 * pre-existing four-hour window), never data loss or a reason to fail the
 * user's delete.
 */
export async function purgeCachePrefix(keyPrefix: string): Promise<boolean> {
  if (!cachePurgeConfigured || !keyPrefix) return false

  // Prefixes are given WITHOUT a scheme — `cdn.xibit360.art/{uid}/{id}`. Deriving
  // it from publicUrl() keeps this in step with whatever base URL is configured
  // (including a base that carries a path) instead of hardcoding the host.
  //
  // The trailing slash callers pass (it matters to deletePrefix, which must not
  // let `{uid}/{id}/` reach the sibling `{uid}/{id}-logo.jpg`) is dropped here:
  // every prefix example Cloudflare documents is slash-free and the docs never
  // confirm a trailing one is accepted. Purging slightly too wide is harmless —
  // those objects still exist and simply repopulate the edge on next request —
  // whereas a rejected purge would silently leave the deleted file servable.
  let prefix: string
  try {
    const url = new URL(publicUrl(keyPrefix))
    prefix = `${url.host}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return false
  }
  // A bare hostname would purge the entire CDN. Only reachable via a caller
  // passing "/" or similar, but the blast radius warrants the guard.
  if (!prefix.includes('/')) return false

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [prefix] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // The API can answer 200 with `success: false` (bad prefix, rate limited), so
    // the status alone does not tell us the cache was actually dropped.
    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; errors?: unknown }
      | null
    if (!res.ok || !body?.success) {
      console.warn('cache purge rejected', res.status, JSON.stringify(body?.errors ?? null))
      return false
    }
    return true
  } catch (e) {
    console.warn('cache purge failed', e)
    return false
  }
}
