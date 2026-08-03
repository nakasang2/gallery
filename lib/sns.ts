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
  /** The whole URL the artist pastes, shown as the input's placeholder. The
   *  dashboard shows and takes full URLs (ユーザー判断 2026-08-03) — the field is
   *  what a visitor will actually open, so there is nothing to work out about
   *  "which part goes in here". */
  sample: string
  /** Hosts that belong to this platform, without `www.`. Used only to catch a
   *  paste into the wrong row; matching is on the registrable part, so any
   *  country/regional subdomain still passes. */
  hosts: string[]
}

// Order = the order shown in the dashboard and on the public page. World-famous
// platforms most relevant to artists. (LinkedIn is intentionally absent — Simple
// Icons dropped its mark at LinkedIn's request, so there is no official icon.)
export const SNS_PLATFORMS: SnsPlatform[] = [
  // i18n-ok: 以下の sample はすべて「貼り付けるURLの見本」（訳す対象ではない）
  { id: 'instagram', label: 'Instagram', kind: 'handle', prefix: 'https://instagram.com/', sample: 'https://instagram.com/yourname', hosts: ['instagram.com', 'instagr.am'] },
  { id: 'x', label: 'X', kind: 'handle', prefix: 'https://x.com/', sample: 'https://x.com/yourname', hosts: ['x.com', 'twitter.com'] },
  { id: 'tiktok', label: 'TikTok', kind: 'handle', prefix: 'https://tiktok.com/@', sample: 'https://tiktok.com/@yourname', hosts: ['tiktok.com'] },
  { id: 'youtube', label: 'YouTube', kind: 'handle', prefix: 'https://youtube.com/@', sample: 'https://youtube.com/@yourname', hosts: ['youtube.com', 'youtu.be'] },
  { id: 'bluesky', label: 'Bluesky', kind: 'handle', prefix: 'https://bsky.app/profile/', sample: 'https://bsky.app/profile/you.bsky.social', hosts: ['bsky.app'] },
  { id: 'behance', label: 'Behance', kind: 'handle', prefix: 'https://behance.net/', sample: 'https://behance.net/yourname', hosts: ['behance.net'] },
  { id: 'pinterest', label: 'Pinterest', kind: 'handle', prefix: 'https://pinterest.com/', sample: 'https://pinterest.com/yourname', hosts: ['pinterest.com'] },
  { id: 'facebook', label: 'Facebook', kind: 'handle', prefix: 'https://facebook.com/', sample: 'https://facebook.com/yourname', hosts: ['facebook.com', 'fb.com', 'fb.me'] },
  { id: 'threads', label: 'Threads', kind: 'handle', prefix: 'https://threads.net/@', sample: 'https://threads.net/@yourname', hosts: ['threads.net', 'threads.com'] },
  // Discord と LINE は「プロフィール」ではなく招待/友だち追加のリンクなので、
  // ハンドルを組み立てず貼られたURLをそのまま持つ（Website と同じ扱い）。
  { id: 'discord', label: 'Discord', kind: 'url', sample: 'https://discord.gg/yourinvite', hosts: ['discord.gg', 'discord.com', 'discordapp.com'] },
  { id: 'line', label: 'LINE', kind: 'url', sample: 'https://lin.ee/yourcode', hosts: ['lin.ee', 'line.me'] },
  { id: 'website', label: 'Website', kind: 'url', sample: 'https://yoursite.com', hosts: [] },
]

const PLATFORM_BY_ID = new Map(SNS_PLATFORMS.map((p) => [p.id, p]))

/** Does this text look like a URL (scheme, or a host before the first slash)? */
export function looksLikeUrl(value: string): boolean {
  const v = value.trim()
  if (/^https?:\/\//i.test(v)) return true
  return /^[^\s/]+\.[a-z]{2,}(\/|$)/i.test(v)
}

/** The host of a URL-ish string, lower-case and without `www.`. '' when unparseable. */
export function hostOf(value: string): string {
  const v = value.trim()
  if (!v) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Compare on the registrable part, so `m.facebook.com` / `jp.pinterest.com` /
 *  `page.line.me` all belong to their platform. */
const hostBelongs = (host: string, hosts: string[]) =>
  hosts.some((h) => host === h || host.endsWith(`.${h}`))

/** The known platform a pasted URL belongs to, if any. */
export function platformFromUrl(value: string): SnsPlatform | null {
  const host = hostOf(value)
  if (!host) return null
  return SNS_PLATFORMS.find((p) => p.hosts.length > 0 && hostBelongs(host, p.hosts)) ?? null
}

/** Reduce a handle input to just the username: strip a leading @, and if the
 *  artist pasted a whole profile URL, keep only its last path segment.
 *
 *  A path with more than one segment is kept whole instead (`youtube.com/channel/UC…`,
 *  `line.me/R/ti/p/@x`): its last segment is not a handle, and `snsUrl` passes any
 *  stored value that is already a URL straight through. */
export function normalizeHandle(value: string): string {
  const v = value.trim()
  if (!v) return ''
  if (looksLikeUrl(v)) {
    try {
      const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
      const segs = u.pathname.split('/').filter(Boolean)
      if (segs.length > 1) return normalizeUrl(v) // 一本道のプロフィールではない
      if (segs.length === 1) return segs[0].replace(/^@+/, '')
      return '' // ホストだけ貼られた（プロフィールを指していない）
    } catch {
      /* not a URL after all — fall through */
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
  // 保存値がすでにURLの形（プロフィールが一本道でない場合。normalizeHandle 参照）なら
  // 前置きを足さずそのまま開く
  if (p.kind === 'url' || looksLikeUrl(value)) return normalizeUrl(value)
  return (p.prefix ?? '') + value
}

/** The value to STORE for one row, from whatever the artist typed or pasted.
 *  Handle rows keep just the username (`@yusuke` → `yusuke`, a pasted profile URL →
 *  its last segment); URL rows keep the whole address with a scheme. Used both by
 *  the dashboard as it edits and by `sanitizeSns` on the way to the DB, so the
 *  field cannot show one thing and the row store another. */
export function normalizeSnsValue(id: string, raw: string): string {
  const p = PLATFORM_BY_ID.get(id)
  if (!p) return normalizeUrl(raw)
  return p.kind === 'url' ? normalizeUrl(raw) : normalizeHandle(raw)
}

/** What the dashboard shows in the field: the whole URL a visitor would open.
 *  Empty stays empty so the placeholder (the sample URL) can do the explaining. */
export function snsDisplayValue(id: string, stored: string): string {
  return stored ? snsUrl(id, stored) : ''
}

/** The row is filled with a link that belongs to a DIFFERENT platform. Returns the
 *  platform it looks like (or `true` when it is some other site entirely), so the
 *  dashboard can say which row it should go in. `null` = nothing to complain about.
 *
 *  Only URLs are judged: a bare handle carries no host, and a half-typed URL
 *  (`https://ins`) has no dot yet, so nothing is flagged while typing.
 *  ユーザー判断 2026-08-03: 取り違えのときだけ注意文を出す（自動で移動はしない）。 */
export function snsMismatch(id: string, raw: string): { found: SnsPlatform | null } | null {
  const p = PLATFORM_BY_ID.get(id)
  if (!p || p.hosts.length === 0) return null // Website / 不明な欄は何でも受ける
  const v = raw.trim()
  if (!v || !looksLikeUrl(v)) return null
  const host = hostOf(v)
  if (!host || hostBelongs(host, p.hosts)) return null
  return { found: platformFromUrl(v) }
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
    const v = normalizeSnsValue(p.id, raw)
    if (v) links[p.id] = v
  }
  const custom = sns.custom
    .map((c) => ({ label: c.label.trim(), url: normalizeUrl(c.url) }))
    .filter((c) => c.url)
  return { links, custom }
}
