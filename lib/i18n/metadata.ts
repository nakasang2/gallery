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
import { DEFAULT_LOCALE, LOCALES, LOCALE_META, localePath, type Locale } from './index'
import { getRequestLocale } from './server'

/** `alternates` for a page whose CONTENT exists in one language only — the guides.
 *
 *  Every locale URL keeps working for people (the chrome around the article is
 *  translated, and a shared `/ja/articles/x` link should not 404), but a crawler
 *  is told to index exactly ONE of them, and hreflang lists only the language a
 *  real version exists in.
 *
 *  The alternative — what this used to do — was to run `localeAlternates` over
 *  the guides, which declares eleven translations of a single English article.
 *  hreflang means "the same content in another language" and Google checks it:
 *  the `ja` URL served English, so the claim was false, and eleven self-canonical
 *  near-duplicates split the ranking signals of one article eleven ways.
 *
 *  When a guide is genuinely translated, give the article a language of its own
 *  and list the locales that have a version — the URL shape does not change. */
export function singleLanguageAlternates(pathname: string, locale: Locale): Metadata['alternates'] {
  const url = `${siteUrl()}${localePath(locale, pathname)}`
  // x-default points at the same URL: it is the only version there is.
  return { canonical: url, languages: { [LOCALE_META[locale].bcp47]: url, 'x-default': url } }
}

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
