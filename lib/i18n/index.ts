// Locale plumbing, with URL prefixes on the pages we author.
//
// URL strategy (docs/DECISIONS 2026-07-28, revising the 2026-07-28 decision that
// left locales out of the URL): the pages Xibit360 writes itself live under a
// locale prefix — `/ja/explore` — because a single URL whose content varies by
// cookie gives a search engine no way to index each language, and no way to
// carry hreflang. Artist pages (`/@name`) deliberately stay on ONE canonical URL:
// their indexable content is the artist's own words, which are never translated,
// so eleven near-identical URLs would only dilute them.
//
// The file tree is untouched: `app/[handle]` already occupies the root dynamic
// segment, and Next.js cannot put `[locale]` beside it. `middleware.ts` rewrites
// `/ja/explore` → `/explore` and passes the locale in a request header instead.
import { en, type Dictionary } from './en'
import { ja } from './ja'
import { ko } from './ko'
import { zhHans } from './zh-hans'
import { zhHant } from './zh-hant'
import { fr } from './fr'
import { es } from './es'
import { de } from './de'
import { ptBr } from './pt-br'
import { it } from './it'
import { id } from './id'

/** Locale ids double as URL segments, so they are lowercase. The canonical
 *  BCP-47 tag (for `<html lang>`, hreflang and Intl) lives in LOCALE_META. */
export const LOCALES = [
  'en',
  'ja',
  'ko',
  'zh-hans',
  'zh-hant',
  'fr',
  'es',
  'de',
  'pt-br',
  'it',
  'id',
] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

/** Cookie the language switcher writes. Read on the server so the first paint is
 *  already in the right language — no flash of English. */
export const LOCALE_COOKIE = 'xibit360.lang'

/** Header `middleware.ts` sets after stripping the locale prefix. Beats the
 *  cookie: the URL is an explicit, shareable, crawlable statement of language. */
export const LOCALE_HEADER = 'x-xibit-locale'

/** What a locale needs from the layout, declared with the locale rather than
 *  hard-coded in CSS.
 *
 *  Typography genuinely differs by writing system — full-width scripts read
 *  larger than Latin at the same pixel size, so display headings need to come
 *  down a notch. The mistake to avoid is spelling that out per LANGUAGE: adding
 *  Korean would then mean hunting down every `html[lang='ja']` rule and adding
 *  `ko` beside it. Declaring the script here means a new locale is one line in
 *  this table and no CSS at all.
 *
 *  `dir` is here for the same reason — it is what makes an RTL locale possible
 *  later without touching every stylesheet. */
export interface LocaleMeta {
  /** Drives `[data-script]` in CSS. Add a value only when it needs different type. */
  script: 'latin' | 'cjk'
  dir: 'ltr' | 'rtl'
  /** Canonical BCP-47 tag: `<html lang>`, `hreflang`, and Intl formatters. */
  bcp47: string
  /** Shown in the language switcher — in the language itself, never translated. */
  label: string
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { script: 'latin', dir: 'ltr', bcp47: 'en', label: 'English' },
  ja: { script: 'cjk', dir: 'ltr', bcp47: 'ja', label: '日本語' },
  // Hangul carries the same full-width weight as CJK at a given pixel size, so it
  // wants the same display-scale step down. Word spacing differs, but that is a
  // line-breaking concern and the headings already use `word-break: auto-phrase`.
  ko: { script: 'cjk', dir: 'ltr', bcp47: 'ko', label: '한국어' },
  'zh-hans': { script: 'cjk', dir: 'ltr', bcp47: 'zh-Hans', label: '简体中文' },
  'zh-hant': { script: 'cjk', dir: 'ltr', bcp47: 'zh-Hant', label: '繁體中文' },
  fr: { script: 'latin', dir: 'ltr', bcp47: 'fr', label: 'Français' },
  es: { script: 'latin', dir: 'ltr', bcp47: 'es', label: 'Español' },
  de: { script: 'latin', dir: 'ltr', bcp47: 'de', label: 'Deutsch' },
  'pt-br': { script: 'latin', dir: 'ltr', bcp47: 'pt-BR', label: 'Português (BR)' },
  it: { script: 'latin', dir: 'ltr', bcp47: 'it', label: 'Italiano' },
  id: { script: 'latin', dir: 'ltr', bcp47: 'id', label: 'Bahasa Indonesia' },
}

/** Paths that get a locale prefix. Everything else — artist pages, the dashboard,
 *  auth, `/terms` and `/privacy` (English is the governing version, so eleven
 *  copies of the same English text would be pure duplication) — stays on one URL.
 *
 *  `''` is the landing page. A trailing `/*` means the segment and anything under it. */
export const LOCALIZED_PATHS = ['', '/explore', '/demo', '/articles', '/legal'] as const

/** Does this path (already stripped of any locale prefix) get a prefix? */
export function isLocalizedPath(pathname: string): boolean {
  const p = pathname === '/' ? '' : pathname.replace(/\/+$/, '')
  return LOCALIZED_PATHS.some((base) => p === base || (base !== '' && p.startsWith(`${base}/`)))
}

/** Split a pathname into its locale prefix (if any) and the path without it.
 *  `/ja/explore` → { locale: 'ja', rest: '/explore' }; `/ja` → rest `/`. */
export function splitLocale(pathname: string): { locale: Locale | null; rest: string } {
  const m = pathname.match(/^\/([^/]+)(\/.*)?$/)
  if (m && isLocale(m[1])) return { locale: m[1], rest: m[2] || '/' }
  return { locale: null, rest: pathname }
}

/** Build the URL for a path in a locale. The default locale is prefixed too:
 *  one shape for every language means no "which page is canonical" ambiguity. */
export function localePath(locale: Locale, pathname: string): string {
  if (!isLocalizedPath(pathname)) return pathname
  const p = pathname === '/' ? '' : pathname.replace(/\/+$/, '')
  return `/${locale}${p}`
}

// A dictionary for a language other than English only has to carry what has
// actually been translated. Anything missing falls through to English, which is
// how a language can ship its first hundred strings without showing raw keys for
// the rest (and how `npm run check:i18n` can report coverage honestly).
type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> }
export type PartialDictionary = DeepPartial<Dictionary>

const OVERRIDES: Record<Locale, PartialDictionary> = {
  en: {},
  ja,
  ko,
  'zh-hans': zhHans,
  'zh-hant': zhHant,
  fr,
  es,
  de,
  'pt-br': ptBr,
  it,
  id,
}

function mergeInto(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = mergeInto((base[k] ?? {}) as Record<string, unknown>, v as Record<string, unknown>)
    } else if (typeof v === 'string') {
      out[k] = v
    }
  }
  return out
}

// Merged once per locale, on the server. The client is handed the finished
// dictionary as a prop, so it never needs the fallback logic — or the other ten
// languages — in its bundle.
const merged = new Map<Locale, Dictionary>()

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v as Locale)
}

export function getDictionary(locale: Locale): Dictionary {
  if (!isLocale(locale)) return en
  const hit = merged.get(locale)
  if (hit) return hit
  const dict = (locale === 'en'
    ? en
    : mergeInto(en as unknown as Record<string, unknown>, OVERRIDES[locale] as Record<string, unknown>)) as Dictionary
  merged.set(locale, dict)
  return dict
}

/** How many of English's strings a locale actually translates. Used by
 *  `npm run check:i18n` to report progress instead of guessing. */
export function translatedKeyCount(locale: Locale): number {
  const count = (node: unknown): number =>
    node && typeof node === 'object'
      ? Object.values(node as Record<string, unknown>).reduce<number>(
          (n, v) => n + (typeof v === 'string' ? 1 : count(v)),
          0,
        )
      : 0
  return count(OVERRIDES[locale])
}

/** Browser tags that should land on a locale we ship. `zh-CN` is Simplified,
 *  `zh-TW`/`zh-HK` Traditional; plain `zh` follows the mainland majority. */
const REGION_ALIASES: Record<string, Locale> = {
  'zh-cn': 'zh-hans',
  'zh-sg': 'zh-hans',
  'zh-hans': 'zh-hans',
  'zh-tw': 'zh-hant',
  'zh-hk': 'zh-hant',
  'zh-mo': 'zh-hant',
  'zh-hant': 'zh-hant',
  zh: 'zh-hans',
  'pt-br': 'pt-br',
  'pt-pt': 'pt-br',
  pt: 'pt-br',
}

/** Pick a locale from an Accept-Language header. Quality values are honoured, and
 *  a region tag matches its base language (`ja-JP` → `ja`). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split('=')[1]) || 0 : 1 }
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q)
  for (const { tag } of ranked) {
    if (REGION_ALIASES[tag]) return REGION_ALIASES[tag]
    if (isLocale(tag)) return tag
    const base = tag.split('-')[0]
    if (REGION_ALIASES[base]) return REGION_ALIASES[base]
    if (isLocale(base)) return base
  }
  return null
}

/** The URL wins, then an explicit choice, then the browser's guess, then default.
 *  The URL is first because it is the one signal that is shareable and crawlable —
 *  a link to `/ja/explore` has to be Japanese for whoever opens it. */
export function resolveLocale(
  urlLocale?: string | null,
  cookieValue?: string | null,
  acceptLanguage?: string | null,
): Locale {
  if (isLocale(urlLocale)) return urlLocale
  if (isLocale(cookieValue)) return cookieValue
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE
}

type Params = Record<string, string | number>

/** Resolve a dotted key against a dictionary, filling `{placeholders}`.
 *
 *  Pass `count` to pick a plural form: the key is looked up as `<key>_one` /
 *  `<key>_other` first (via Intl.PluralRules for the locale, so languages with
 *  no plural distinction — Japanese — simply always land on `_other`).
 *
 *  A missing key returns the key itself rather than throwing: a label reading
 *  "explore.title" in one corner is a bug you can see and fix, a crashed
 *  gallery is one you cannot. TypeScript is what actually prevents this. */
export function translate(dict: Dictionary, locale: Locale, key: string, params?: Params): string {
  const lookup = (k: string): unknown =>
    k.split('.').reduce<unknown>((node, part) => {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
        return (node as Record<string, unknown>)[part]
      }
      return undefined
    }, dict)

  let value: unknown
  if (params && typeof params.count === 'number') {
    const form = new Intl.PluralRules(LOCALE_META[locale]?.bcp47 ?? locale).select(params.count)
    value = lookup(`${key}_${form}`) ?? lookup(`${key}_other`) ?? lookup(key)
  } else {
    value = lookup(key)
  }
  if (typeof value !== 'string') return key
  if (!params) return value
  return value.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}
