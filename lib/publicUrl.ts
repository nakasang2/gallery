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
//
// (A Cloudflare Transform Rule now also sets `Access-Control-Allow-Origin: *` on
// every response from cdn.xibit360.art, so the header no longer depends on the
// request — see docs/DECISIONS.md 2026-07-27 "CDN配信のCORS". The rule above
// still stands: it keeps one cache entry serving both 2D and 3D.)

const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE ?? '').replace(/\/+$/, '')

/** True once the public base URL is configured. */
export const publicUrlConfigured = base.length > 0

/** Absolute URL for a stored object key (e.g. `{uid}/{artworkId}/display.jpg`). */
export function publicUrl(key: string): string {
  return `${base}/${key.replace(/^\/+/, '')}`
}

/* ---- Bundled static assets (3D models, floor textures, demo media) ---- */

/**
 * Version segment for the static-asset prefix in R2.
 *
 * The CDN caches cdn.xibit360.art for a month, so a replaced asset would keep
 * serving the old bytes. Bump this when any file under `public/models`,
 * `public/textures` or `public/demo-works` changes — that gives every asset a new
 * URL — then re-run `scripts/upload-static-assets.mjs` (it reads this constant, so
 * the two cannot drift).
 */
export const STATIC_VERSION = 'v1'

/**
 * URL for an asset that ships in `public/` but is SERVED FROM R2.
 *
 * Why: these are the heaviest thing a first-time visitor downloads — the two
 * rigged visitor models alone are 2.6MB, preloaded at module scope by
 * GhostVisitors — and out of `public/` they came off Vercel's bandwidth. R2 egress
 * is free, so serving them from the same CDN as the artwork keeps per-visitor cost
 * flat no matter how popular a gallery gets (docs/DECISIONS.md 2026-07-27).
 *
 * `path` is the path as it appears under `public/`, e.g. `models/visitor.glb`.
 * The files stay in `public/`, so an unconfigured environment (local dev with no
 * env file) transparently falls back to serving them from the app itself.
 *
 * NOT for the Draco decoder: `public/draco/` is deliberately served locally so the
 * glTF loader never depends on a separate origin (docs/LESSONS.md 2026-07-16).
 */
export function assetUrl(path: string): string {
  const clean = path.replace(/^\/+/, '')
  return publicUrlConfigured ? `${base}/static/${STATIC_VERSION}/${clean}` : `/${clean}`
}
