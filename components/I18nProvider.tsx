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

// One module-level object, not a fresh one per call: `t` is used as a useMemo
// dependency by callers that build expensive things from it (the LP wall textures
// are baked into canvases keyed on it). A new identity on every render would
// rebuild them on every scroll tick.
const FALLBACK: I18nValue = {
  locale: DEFAULT_LOCALE,
  t: (key, params) => translate(en, DEFAULT_LOCALE, key, params),
  setLocale: () => {},
}

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
  return useContext(I18nContext) ?? FALLBACK
}

/** The common case — just the translate function. */
export function useT(): I18nValue['t'] {
  return useI18n().t
}

/** The 特商法 disclosure, offered only in Japanese.
 *
 *  It is a Japanese-law disclosure whose Japanese version is the one that
 *  legally operates, so promoting it in ten other languages would put a
 *  Japanese obligation under a foreign label — the German footer read
 *  `Impressum` and pointed here, which is a promise this page does not keep.
 *  The page itself stays reachable at `/legal` (the English Terms cross-reference
 *  it), it just is not advertised outside Japanese. Decided 2026-07-29.
 *
 *  Renders nothing in other languages — including the separator, which is why the
 *  callers put the `·` inside this component rather than beside it. */
export function LegalLink({ before }: { before?: React.ReactNode }) {
  const { locale, t } = useI18n()
  if (locale !== 'ja') return null
  return (
    <>
      {before}
      <Link href="/legal">{t('footer.legal')}</Link>
    </>
  )
}

/** 文の中の一箇所だけを要素（太字など）に差し替えて描く。
 *
 *  値を挟む文は**ひとつのキー**に収めるのが決まりで（語順・助詞・語形変化は言語側に
 *  委ねる。LESSONS 2026-07-29 の `{unit}` と `presets.frameOf`）、素朴にやると
 *  「文の前半キー ＋ <b>値</b> ＋ 文の後半キー」という連結に戻ってしまう。
 *
 *  そこで `t()` に**パラメータを渡さず**受け取り（`translate()` は渡されなかった
 *  プレースホルダをそのまま残す）、その位置で割って要素を挟む。訳文がその
 *  プレースホルダを持たない言語でも、前半だけが描かれて文は途切れない。 */
export function TextWithSlot({
  text,
  slot,
  children,
}: {
  text: string
  slot: string
  children: React.ReactNode
}) {
  const [before, after] = text.split(`{${slot}}`)
  return (
    <>
      {before}
      {children}
      {after ?? ''}
    </>
  )
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
