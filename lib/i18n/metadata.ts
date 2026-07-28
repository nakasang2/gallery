// hreflang and canonical for the pages that carry a locale prefix.
//
// Two things a multilingual site has to say to a crawler, and they are easy to
// get subtly wrong:
//
//   canonical — "index THIS url for this page", so `/ja/explore` never competes
//     with `/en/explore` as a duplicate. Without it, eleven URLs of the same
//     layout look like eleven near-duplicates and the wrong one wins.
//
//   alternates.languages — "the same page in other languages, here". Must list
//     EVERY language including the current one (Google's rule: the set has to be
//     reciprocal and self-referential), plus `x-default` for a visitor whose
//     language we do not publish.
//
// The tags use the canonical BCP-47 tag (`zh-Hant`), while the URL segment stays
// lowercase (`/zh-hant/…`) — hreflang values are language tags, not paths.
import type { Metadata } from 'next'
import { siteUrl } from '@/lib/publicUrl'
import { DEFAULT_LOCALE, LOCALES, LOCALE_META, localePath } from './index'
import { getRequestLocale } from './server'

/** `alternates` for a localized path (`''` for the landing page, `/explore`, …). */
export async function localeAlternates(pathname: string): Promise<Metadata['alternates']> {
  const locale = await getRequestLocale()
  const base = siteUrl()
  const languages: Record<string, string> = {}
  for (const l of LOCALES) languages[LOCALE_META[l].bcp47] = `${base}${localePath(l, pathname)}`
  // x-default is for "we do not publish your language" — English, our default.
  languages['x-default'] = `${base}${localePath(DEFAULT_LOCALE, pathname)}`
  return { canonical: `${base}${localePath(locale, pathname)}`, languages }
}
