// Server-component counterpart to useT(). Same resolution order as the root
// layout (URL → cookie → Accept-Language → default), so a page and the client
// components inside it always agree on the language.
//
// The URL comes first and arrives as a request header, set by `middleware.ts`
// after it strips the `/ja/…` prefix. It has to beat the cookie: a link to
// `/ja/explore` must be Japanese for whoever opens it, even if their own cookie
// says otherwise.
import { cookies, headers } from 'next/headers'
import {
  getDictionary,
  resolveLocale,
  translate,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  type Locale,
} from './index'

/** The locale this request should render in. */
export async function getRequestLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  return resolveLocale(
    headerList.get(LOCALE_HEADER),
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get('accept-language'),
  )
}

export async function getServerT(): Promise<{
  locale: Locale
  t: (key: string, params?: Record<string, string | number>) => string
}> {
  const locale = await getRequestLocale()
  const dictionary = getDictionary(locale)
  return { locale, t: (key, params) => translate(dictionary, locale, key, params) }
}
