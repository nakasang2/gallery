// Public read URLs for stored files. Shared by client and server, so this must
// stay free of secrets and of any Node-only import.
//
// Objects are served straight off the R2 bucket's custom domain
// (cdn.xibit360.art), which is why reads cost us nothing in egress. Keys are the
// same relative paths we already stored in `artworks.storage_path`, so switching
// providers was a change of base URL rather than a data migration for artworks
// (absolute URLs held in other columns were rewritten once — migration 0029).
//
// ⚠️ RULE: every <img> that renders one of these URLs MUST set
// crossOrigin="anonymous".
//
// The 3D gallery reads the same files as WebGL textures, which is always a CORS
// request. R2 only returns Access-Control-Allow-Origin when the request carried
// an Origin header — unlike Supabase Storage, which sent it unconditionally. So a
// plain <img> (no Origin) caches a response with no CORS headers, and the texture
// request afterwards reuses that cached response and fails: the frame renders
// empty while the 2D thumbnail of the same file looks fine. Setting crossOrigin
// on the <img> makes every fetch a CORS fetch, so one good cache entry serves
// both. See docs/LESSONS.md 2026-07-27.

const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE ?? '').replace(/\/+$/, '')

/** True once the public base URL is configured. */
export const publicUrlConfigured = base.length > 0

/** Absolute URL for a stored object key (e.g. `{uid}/{artworkId}/display.jpg`). */
export function publicUrl(key: string): string {
  return `${base}/${key.replace(/^\/+/, '')}`
}
