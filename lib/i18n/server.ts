// Server-component counterpart to useT(). Same resolution order as the root
// layout (cookie → Accept-Language → default), so a page and the client
// components inside it always agree on the language.
import { cookies, headers } from 'next/headers'
import { getDictionary, resolveLocale, translate, LOCALE_COOKIE, type Locale } from './index'

export async function getServerT(): Promise<{
  locale: Locale
  t: (key: string, params?: Record<string, string | number>) => string
}> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get('accept-language'))
  const dictionary = getDictionary(locale)
  return { locale, t: (key, params) => translate(dictionary, locale, key, params) }
}
