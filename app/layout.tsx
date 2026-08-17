import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import Analytics from '@/components/Analytics'
import ConsentBanner from '@/components/ConsentBanner'
import { CONSENT_DENIED_REGIONS } from '@/lib/analytics'
import { I18nProvider } from '@/components/I18nProvider'
import { getDictionary, LOCALE_META } from '@/lib/i18n'
import { getRequestLocale } from '@/lib/i18n/server'
import { siteUrl } from '@/lib/publicUrl'
import './landing.css'
import './gallery.css'
import './auth.css'
import './me.css'
import './catalog.css'
import './articles.css'

export const metadata: Metadata = {
  // Without this, every relative URL in `metadata` — the canonical each public page
  // now sets, and the OG card produced by the opengraph-image convention — is
  // resolved against the deployment host. On Vercel that is the per-deploy
  // `*.vercel.app` domain, so shared cards and canonicals pointed at a URL nobody
  // should be indexing (docs/DECISIONS 2026-07-30 SEO).
  metadataBase: new URL(siteUrl()),
  // サイト全体の既定（自分で metadata を持たないページはこれが出る）。LPだけは
  // app/page.tsx が `seo.homeTitle` / `seo.homeDesc` で言語ごとに上書きする。
  // **英語の言い回しはそちらの en と揃えること** — ここは辞書を通らないので
  // `check:i18n` の視界に入らず、LPの文言を変えても黙って古いまま残る
  // （実際にヒーローを作り直した 2026-08-15 に、ここだけ旧タグラインで残っていた）。
  title: 'Xibit360 — Give your work a place of its own.',
  description:
    'Xibit360 turns your work into a 3D exhibition people can walk through. Free to start, minutes to open, nothing to install — one link opens your show to the world.',
  openGraph: {
    title: 'Xibit360 — Give your work a place of its own.',
    description: 'Exhibit your art as a 3D gallery people can walk through — one link, no installs.',
    siteName: 'Xibit360',
    locale: 'en_US',
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Without this, iOS resolves every env(safe-area-inset-*) to 0 — which silently
  // disabled all fourteen notch/home-bar rules in app/gallery.css. Paying for it:
  // the page now paints into those areas, so app/gallery.css gives non-gallery
  // pages a baseline inset and the fixed chrome opts in with max().
  viewportFit: 'cover',
}

// Server-resolved so the first paint is already in the visitor's language —
// deciding on the client would flash English first, which is exactly the moment
// a shared link makes its impression.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale()
  // Ask for consent only where it is actually required. Vercel resolves the
  // visitor's country into this header at the edge; absent (local dev, a
  // self-hosted run) we do NOT show the bar. That direction is the safe one:
  // the worst case is under-measuring, because Consent Mode's regional default
  // already keeps EEA/UK/CH cookieless whether or not this bar ever appears.
  const country = (await headers()).get('x-vercel-ip-country')?.toUpperCase() ?? ''
  const consentRequired = CONSENT_DENIED_REGIONS.includes(country)
  const dictionary = getDictionary(locale)
  const meta = LOCALE_META[locale]
  return (
    // `lang` is the canonical BCP-47 tag, not the URL segment: the segment is
    // lowercase (`/zh-hans/…`) because URLs are, but a browser and a screen reader
    // want `zh-Hans`.
    //
    // `data-script` is what stylesheets key off — never the language itself, so a
    // new locale needs no CSS (lib/i18n LOCALE_META).
    <html lang={meta.bcp47} dir={meta.dir} data-script={meta.script}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Loaded at runtime rather than via next/font because these fonts are also used for canvas textures (name plates, etc.) */}
        {/* 書体名を変えるときは app/landing.css の `--serif` / `--sans` と必ず揃える（lib/fonts.ts がそこを読む） */}
        <link
          href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <I18nProvider locale={locale} dictionary={dictionary}>
          {children}
          {/* Inside the provider — the bar is translated, so it needs useT(). */}
          <ConsentBanner required={consentRequired} />
        </I18nProvider>
        {/* Renders nothing unless NEXT_PUBLIC_GA_ID is set, so local dev, preview
            deploys and forks send no data (components/Analytics). */}
        <Analytics />
      </body>
    </html>
  )
}
