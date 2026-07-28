'use client'
// Carries the dictionary the server already resolved down to client components.
//
// The dictionary is passed as a prop rather than imported here so only the
// active locale is sent to the browser — importing every locale would ship all
// of them in the client bundle.
import { createContext, useCallback, useContext, useMemo } from 'react'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALES,
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
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    // Reload rather than swap in place — server components rendered the current
    // language, so re-fetching them is what actually changes the page.
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

const LABELS: Record<Locale, string> = { en: 'English', ja: '日本語' }

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
            {LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  )
}
