import type { Metadata, Viewport } from 'next'
import { cookies, headers } from 'next/headers'
import { I18nProvider } from '@/components/I18nProvider'
import { getDictionary, resolveLocale, LOCALE_COOKIE } from '@/lib/i18n'
import './landing.css'
import './gallery.css'
import './auth.css'
import './me.css'
import './catalog.css'
import './articles.css'

export const metadata: Metadata = {
  title: 'Xibit360 — Your work, given space.',
  description:
    'Xibit360 turns your portfolio into a walkable 3D exhibition. Upload your work, compose the room, and open your show to the world with a single URL.',
  openGraph: {
    title: 'Xibit360 — Your work, given space.',
    description: 'A platform for exhibiting art as walkable 3D galleries.',
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
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get('accept-language'),
  )
  const dictionary = getDictionary(locale)
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Loaded at runtime rather than via next/font because these fonts are also used for canvas textures (name plates, etc.) */}
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <I18nProvider locale={locale} dictionary={dictionary}>
          {children}
        </I18nProvider>
      </body>
    </html>
  )
}
