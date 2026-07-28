// Locale prefixes on the pages we author, without moving a single route file.
//
// `app/[handle]` already occupies the root dynamic segment, and Next.js cannot
// place `[locale]` beside it — so instead of `app/[locale]/…` this rewrites
// `/ja/explore` → `/explore` and hands the locale down in a request header that
// `getServerT()` reads (docs/DECISIONS 2026-07-28 "多言語SEO をやる").
//
// Three cases, in order:
//   1. `/{locale}/…`   → rewrite to the bare path, set the locale header.
//   2. a localizable path with no prefix → redirect to the visitor's language.
//   3. anything else (artist pages, dashboard, auth, /terms, /privacy, API,
//      assets) → untouched. Those live on one URL by design.
import { NextResponse, type NextRequest } from 'next/server'
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  isLocalizedPath,
  localePath,
  resolveLocale,
  splitLocale,
} from '@/lib/i18n'

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const { locale, rest } = splitLocale(pathname)

  // 1. Prefixed: serve the underlying route, telling it which language to render.
  if (locale) {
    // A prefix on a path that is not localized (`/ja/me`) is not a page we
    // publish — send it to the real one rather than rendering a second copy.
    if (!isLocalizedPath(rest)) {
      return NextResponse.redirect(new URL(`${rest}${search}`, req.url), 308)
    }
    const headers = new Headers(req.headers)
    headers.set(LOCALE_HEADER, locale)
    return NextResponse.rewrite(new URL(`${rest}${search}`, req.url), { request: { headers } })
  }

  // 2. Unprefixed but localizable: pick a language and move to its URL. A
  //    temporary redirect on purpose — the destination depends on who is asking,
  //    so it must not be cached as though it were the one true answer. hreflang
  //    and the canonical tag are what tell a crawler which URL to index.
  if (isLocalizedPath(pathname)) {
    const picked = resolveLocale(
      null,
      req.cookies.get(LOCALE_COOKIE)?.value,
      req.headers.get('accept-language'),
    )
    return NextResponse.redirect(new URL(`${localePath(picked, pathname)}${search}`, req.url), 307)
  }

  // 3. Everything else is deliberately single-URL.
  return NextResponse.next()
}

export const config = {
  // Skip Next's internals, the API, metadata routes, and anything with a file
  // extension. `/@handle` paths fall through to case 3 above and are untouched,
  // but excluding assets here keeps the middleware off the hot path entirely.
  matcher: ['/((?!_next/|api/|robots\\.txt|sitemap\\.xml|.*\\.[^/]+$).*)'],
}
