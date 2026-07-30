// The artist's social links, shown wherever their name appears in public. Known
// platforms (with official brand icons) plus free-form "other" links.
//
// Stored in the single `profiles.sns` jsonb column — no DB migration needed. The
// shape is `{ links, custom }`; the OLD flat shape `{ x, instagram, website }` is
// migrated on read (readSns), so existing rows keep working and are rewritten to
// the new shape the next time the artist saves.

export interface CustomLink {
  label: string
  url: string
}

export interface SnsLinks {
  /** Known-platform id (see SNS_PLATFORMS) → handle (social) or full URL (website) */
  links: Record<string, string>
  /** Arbitrary labelled links the artist added under "Other" */
  custom: CustomLink[]
}

export const EMPTY_SNS: SnsLinks = { links: {}, custom: [] }

/** A known platform. `kind: 'handle'` takes a username and builds the URL from
 *  `prefix`; `kind: 'url'` takes a full URL. `label` is a brand name (proper noun,
 *  not translated). `icon` keys into components/BrandIcons. */
export interface SnsPlatform {
  id: string
  label: string
  kind: 'handle' | 'url'
  /** For handle platforms: the URL before the handle (includes any @). */
  prefix?: string
  /** Hint shown next to the input, e.g. "x.com/" or "@". */
  hint?: string
}

// Order = the order shown in the dashboard and on the public page. World-famous
// platforms most relevant to artists. (LinkedIn is intentionally absent — Simple
// Icons dropped its mark at LinkedIn's request, so there is no official icon.)
export const SNS_PLATFORMS: SnsPlatform[] = [
  { id: 'instagram', label: 'Instagram', kind: 'handle', prefix: 'https://instagram.com/', hint: 'instagram.com/' },
  { id: 'x', label: 'X', kind: 'handle', prefix: 'https://x.com/', hint: 'x.com/' },
  { id: 'tiktok', label: 'TikTok', kind: 'handle', prefix: 'https://tiktok.com/@', hint: 'tiktok.com/@' },
  { id: 'youtube', label: 'YouTube', kind: 'handle', prefix: 'https://youtube.com/@', hint: 'youtube.com/@' },
  { id: 'behance', label: 'Behance', kind: 'handle', prefix: 'https://behance.net/', hint: 'behance.net/' },
  { id: 'pinterest', label: 'Pinterest', kind: 'handle', prefix: 'https://pinterest.com/', hint: 'pinterest.com/' },
  { id: 'facebook', label: 'Facebook', kind: 'handle', prefix: 'https://facebook.com/', hint: 'facebook.com/' },
  { id: 'threads', label: 'Threads', kind: 'handle', prefix: 'https://threads.net/@', hint: 'threads.net/@' },
  { id: 'website', label: 'Website', kind: 'url', hint: 'https://' },
]

const PLATFORM_BY_ID = new Map(SNS_PLATFORMS.map((p) => [p.id, p]))

/** Reduce a handle input to just the username: strip a leading @, and if the
 *  artist pasted a whole profile URL, keep only its last path segment. */
export function normalizeHandle(value: string): string {
  let v = value.trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v) || v.includes('/')) {
    try {
      const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
      const seg = u.pathname.split('/').filter(Boolean).pop()
      if (seg) v = seg
    } catch {
      /* not a URL after all — leave it */
    }
  }
  return v.replace(/^@+/, '')
}

/** A full URL from free text: add https:// when the scheme is missing. */
export function normalizeUrl(value: string): string {
  const v = value.trim()
  if (!v) return ''
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

/** Absolute URL for one known-platform value. Shared by the icon row visitors
 *  click and the `sameAs` list in the structured data, so a crawler is told about
 *  exactly the same profiles the page links to. */
export function snsUrl(id: string, value: string): string {
  const p = PLATFORM_BY_ID.get(id)
  if (!p) return normalizeUrl(value)
  return p.kind === 'url' ? normalizeUrl(value) : (p.prefix ?? '') + value
}

/** Every link (known + custom) as absolute URLs, in display order — for `sameAs`. */
export function allSnsUrls(sns: SnsLinks): string[] {
  const known = SNS_PLATFORMS.filter((p) => sns.links[p.id]).map((p) => snsUrl(p.id, sns.links[p.id]))
  const custom = sns.custom.filter((c) => c.url).map((c) => normalizeUrl(c.url))
  return [...known, ...custom]
}

/** Parse the jsonb column into SnsLinks, migrating the old flat shape. */
export function readSns(raw: unknown): SnsLinks {
  const r = (raw ?? {}) as Record<string, unknown>
  const links: Record<string, string> = {}
  if (r.links && typeof r.links === 'object') {
    // New shape
    const rl = r.links as Record<string, unknown>
    for (const p of SNS_PLATFORMS) {
      const v = rl[p.id]
      if (typeof v === 'string' && v) links[p.id] = v
    }
  } else {
    // Old flat shape { x, instagram, website } — migrate on read
    for (const id of ['x', 'instagram', 'website']) {
      const v = r[id]
      if (typeof v === 'string' && v) links[id] = v
    }
  }
  const custom: CustomLink[] = Array.isArray(r.custom)
    ? (r.custom as unknown[]).flatMap((c) => {
        const o = (c ?? {}) as Record<string, unknown>
        const label = typeof o.label === 'string' ? o.label : ''
        const url = typeof o.url === 'string' ? o.url : ''
        return url ? [{ label, url }] : []
      })
    : []
  return { links, custom }
}

/** Sanitise SnsLinks for writing back to the DB (handles → username, urls → https). */
export function sanitizeSns(sns: SnsLinks): SnsLinks {
  const links: Record<string, string> = {}
  for (const p of SNS_PLATFORMS) {
    const raw = sns.links[p.id]
    if (!raw) continue
    const v = p.kind === 'url' ? normalizeUrl(raw) : normalizeHandle(raw)
    if (v) links[p.id] = v
  }
  const custom = sns.custom
    .map((c) => ({ label: c.label.trim(), url: normalizeUrl(c.url) }))
    .filter((c) => c.url)
  return { links, custom }
}
