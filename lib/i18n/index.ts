// Locale plumbing, deliberately without URL routing.
//
// Why no /ja/… prefix: `app/[handle]` sits at the root, and Next.js cannot have
// a second dynamic segment (`[locale]`) beside it — prefixed locales would mean
// moving every route under `[locale]` plus middleware. The SEO that buys is
// mostly for the landing page and articles; an artist page's indexable content
// is the artist's own words, which are never translated. Decided 2026-07-28
// (docs/DECISIONS) — revisit when there is marketing content worth indexing per
// language.
import { en, type Dictionary } from './en'
import { ja } from './ja'

export const LOCALES = ['en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

/** Cookie the language switcher writes. Read on the server so the first paint is
 *  already in the right language — no flash of English. */
export const LOCALE_COOKIE = 'xibit360.lang'

const DICTIONARIES: Record<Locale, Dictionary> = { en, ja }

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v)
}

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? en
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
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }
  return null
}

/** Explicit choice beats the browser's guess; the browser beats the default. */
export function resolveLocale(cookieValue?: string | null, acceptLanguage?: string | null): Locale {
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
    const form = new Intl.PluralRules(locale).select(params.count)
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
