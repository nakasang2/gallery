// The exhibition's own public name — its slug (ユーザー決定 2026-08-09).
//
// It drives `xibit360.art/expo/{slug}`, which is the shipped URL. The host parser
// further down maps `{slug}.xibit360.art` onto the same exhibition and is DORMANT:
// `NEXT_PUBLIC_EXPO_DOMAIN` is left unset, so nothing resolves and no canonical points
// at a host. A subdomain costs a Vercel domain plus a DNS record per exhibition, by
// hand, against a 50-domain cap — work that grows with the number of shows, which is
// why the path won. The parser stays because turning subdomains on later is then an
// environment variable and DNS rather than a code change.
//
// A subdomain is an OPTIONAL ALIAS. Every exhibition is always published at
// `/@handle` — the subdomain only changes which URL is canonical and promoted. Three
// consequences worth keeping, because they are what make the feature safe to ship
// before the DNS side is fully automated:
//   - nothing breaks when an account has no subdomain (that is every account today)
//   - the Vercel domain limit (50 per project, Hobby) is a ceiling on ALIASES, not on
//     exhibitions: run out and new shows simply keep their `/@handle` URL
//   - a preview deployment, where the feature is switched off, still serves everything
//
// NOT a wildcard. Vercel will only issue a `*.domain` certificate if the domain's
// nameservers are delegated to Vercel, and this zone must stay on Cloudflare because
// `cdn.xibit360.art` is an R2 custom domain (which requires the zone to be a
// Cloudflare zone) with a Transform Rule that fixes CORS on it. So each subdomain is a
// real host added to the project one at a time, which gets an ordinary HTTP-01
// certificate that renews the same way `www` does.

/** The zone exhibition subdomains live under, e.g. `xibit360.art`. Unset switches the
 *  whole feature off: hosts resolve to nothing and no canonical is rewritten. Left
 *  unset on previews and locally, where `*.xibit360.art` does not point at the
 *  deployment and pretending otherwise would emit canonical URLs to a host that
 *  serves something else. */
const zone = (process.env.NEXT_PUBLIC_EXPO_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')

export const expoHostsEnabled = zone.length > 0

/** Same shape as a room slug (`SLUG_RE`), with a 3-character floor: too short a name is
 *  not worth the collision risk, and it has to be a legal DNS label in case the host
 *  route is ever switched on. */
export const EXPO_SLUG_RE = /^[a-z0-9-]{3,40}$/

/**
 * Names that must never become an exhibition.
 *
 * `www` and `cdn` are live hosts (the app and the R2 CDN); the rest are what mail,
 * tooling and future infrastructure conventionally take, plus the app's own route names.
 * Handing one out would be unrecoverable — the exhibition works until the day we need
 * the name, and by then it is on somebody's printed flyer.
 *
 * The list covers hosts AND paths together. `/expo/{slug}` cannot actually collide with
 * an app route (it is one segment deeper), so most of these are only load-bearing for
 * the dormant host route — but keeping one list means switching hosts on later cannot
 * discover that a name already handed out is unusable.
 */
const RESERVED = new Set([
  'www', 'cdn', 'api', 'admin', 'app', 'assets', 'static', 'media', 'img', 'images',
  'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'webmail', 'ns', 'ns1', 'ns2',
  'dev', 'staging', 'stage', 'test', 'preview', 'demo', 'beta', 'alpha', 'local',
  'blog', 'docs', 'help', 'support', 'status', 'about', 'shop', 'store', 'pay',
  'billing', 'account', 'accounts', 'auth', 'login', 'signin', 'signup', 'me',
  'explore', 'articles', 'legal', 'terms', 'privacy', 'expo', 'xibit360', 'vercel',
  '_acme-challenge', 'autodiscover', 'autoconfig', 'cpanel', 'ftp', 'vpn',
])

/** Why this slug cannot be used, or null when it can. */
export function expoSlugError(sub: string): 'format' | 'reserved' | null {
  const s = sub.trim().toLowerCase()
  if (!EXPO_SLUG_RE.test(s)) return 'format'
  // A leading/trailing hyphen is not a legal DNS label even though the class allows it
  // positionally, and `xn--` is the punycode prefix — neither belongs to an artist.
  if (s.startsWith('-') || s.endsWith('-') || s.startsWith('xn--')) return 'format'
  if (RESERVED.has(s)) return 'reserved'
  return null
}

/** Path for an exhibition: the front-door room at `/expo/{slug}`, a sub-room one deeper.
 *  This is the shipped URL shape. */
export function expoPath(slug: string, roomPath = ''): string {
  return `/expo/${slug}${roomPath}`
}

/**
 * The exhibition subdomain a request arrived on, or null. Dormant unless
 * `NEXT_PUBLIC_EXPO_DOMAIN` is set — see the note at the top of the file.
 *
 * Deliberately string-only: this runs in middleware, on every request, and a database
 * lookup there would put a round trip in front of every page of the site. The route it
 * rewrites to does the lookup instead, where it can be memoised per request.
 *
 * The port is stripped so a proxied host (`sub.xibit360.art:443`) still matches.
 */
export function expoSlugFromHost(host: string | null): string | null {
  if (!expoHostsEnabled || !host) return null
  const h = host.trim().toLowerCase().split(':')[0]
  if (!h.endsWith(`.${zone}`)) return null
  const label = h.slice(0, -(zone.length + 1))
  // Exactly one level. `a.b.xibit360.art` is not an exhibition, and treating it as one
  // would let a nested host impersonate `b`.
  if (!label || label.includes('.')) return null
  return expoSlugError(label) === null ? label : null
}

/** Absolute URL for an exhibition served on its own subdomain. `path` is the room's
 *  path within the show (`''` for the front-door room, `/slug` otherwise). */
export function expoUrl(subdomain: string, path = ''): string {
  return `https://${subdomain}.${zone}${path}`
}

/** The zone itself, for copy that has to show the shape of the URL. Empty when the
 *  feature is off, so callers can hide the UI rather than print a broken example. */
export function expoZone(): string {
  return zone
}
