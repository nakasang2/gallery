// There was no robots.txt at all, which leaves crawling entirely to guesswork —
// including whether to spend budget on the dashboard and auth pages.
import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/publicUrl'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Nothing here is secret (they all require a session), but they are dead
      // ends for a crawler and dilute what gets indexed.
      disallow: ['/me', '/admin', '/signin', '/signup', '/reset', '/report'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
