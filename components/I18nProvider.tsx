'use client'
// Carries the dictionary the server already resolved down to client components.
//
// The dictionary is passed as a prop rather than imported here so only the
// active locale is sent to the browser — importing every locale would ship all
// of them in the client bundle.
import { createContext, useCallback, useContext, useMemo, type ComponentProps } from 'react'
import Link from 'next/link'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_META,
  LOCALES,
  isLocalizedPath,
  localePath,
  splitLocale,
  translate,
  type Locale,
} from '@/lib/i18n'
import { en, type Dictionary } from '@/lib/i18n/en'

interface I18nValue {
  locale: Locale
  t: (key: string, params?: Record<string, string | number>) => string
  setLocale: (next: Locale) => void
}

// Falling back to English rather than throwing keeps anything rendered outside
// the provider (tests, a stray portal) working instead of blanking the page.
const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale
  dictionary: Dictionary
  children: React.ReactNode
}) {
  const setLocale = useCallback((next: Locale) => {
    // A year, path-wide, Lax: this is a display preference, not a credential.
    // Still written on localized pages so the NEXT visit to a page that has no
    // locale prefix (the dashboard, an artist's room) opens in the same language.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    const { pathname, search, hash } = window.location
    const { rest } = splitLocale(pathname)
    // On a page that carries a locale in its URL, switching language means going
    // to that language's URL — otherwise the address bar would keep claiming a
    // language the page no longer shows, and the link would be wrong to share.
    if (isLocalizedPath(rest)) {
      window.location.assign(`${localePath(next, rest)}${search}${hash}`)
      return
    }
    // Elsewhere the cookie is the only signal, so a reload is what re-renders the
    // server components in the new language.
    window.location.reload()
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: (key, params) => translate(dictionary, locale, key, params),
      setLocale,
    }),
    [locale, dictionary, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (ctx) return ctx
  return {
    locale: DEFAULT_LOCALE,
    t: (key, params) => translate(en, DEFAULT_LOCALE, key, params),
    setLocale: () => {},
  }
}

/** The common case — just the translate function. */
export function useT(): I18nValue['t'] {
  return useI18n().t
}

/** `next/link` that keeps the visitor in their language.
 *
 *  Links to a page we author (`/explore`, `/articles/…`) need the locale prefix:
 *  without it every internal click is a 307 through middleware, and a crawler has
 *  to follow a redirect to find anything but the default language. Links to a page
 *  that lives on ONE url (`/signup`, `/me`, an artist's room) are passed straight
 *  through by `localePath`, so this is safe to use for any internal link.
 *
 *  A client component on purpose: it reads the locale from context, so it works
 *  the same inside a server component (rendered on the server, so the href a
 *  crawler sees is already prefixed) as inside a client one. */
export function LocaleLink({ href, ...rest }: ComponentProps<typeof Link>) {
  const { locale } = useI18n()
  return <Link href={typeof href === 'string' ? localePath(locale, href) : href} {...rest} />
}

/** Language switcher. Deliberately a plain <select>: it is one control that has
 *  to work on every device, and the native picker already knows how. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()
  return (
    <label className={`lang-switch${className ? ` ${className}` : ''}`}>
      <span className="lang-switch-label">{t('common.language')}</span>
      <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_META[l].label}
          </option>
        ))}
      </select>
    </label>
  )
}
