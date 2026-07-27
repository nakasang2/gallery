// Public read URLs for stored files. Shared by client and server, so this must
// stay free of secrets and of any Node-only import.
//
// Objects are served straight off the R2 bucket's custom domain
// (cdn.xibit360.art), which is why reads cost us nothing in egress. Keys are the
// same relative paths we already stored in `artworks.storage_path`, so switching
// providers was a change of base URL rather than a data migration for artworks
// (absolute URLs held in other columns were rewritten once — migration 0029).

const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE ?? '').replace(/\/+$/, '')

/** True once the public base URL is configured. */
export const publicUrlConfigured = base.length > 0

/** Absolute URL for a stored object key (e.g. `{uid}/{artworkId}/display.jpg`). */
export function publicUrl(key: string): string {
  return `${base}/${key.replace(/^\/+/, '')}`
}
