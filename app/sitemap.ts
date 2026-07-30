// There was no sitemap, which for a service whose growth plan leans on search
// ("オンライン個展", "virtual gallery free" — docs/STRATEGY §4.1-3) meant every
// artist page depended on a crawler stumbling into it from Explore.
//
// Every URL here is already public and server-rendered; nothing private is
// listed (see app/robots.ts for what is explicitly kept out).
import type { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'
import { siteUrl } from '@/lib/publicUrl'
import { fetchPublishedArticles } from '@/lib/blog'
import { DEFAULT_LOCALE, LOCALES, LOCALE_META, localePath } from '@/lib/i18n'

// Public galleries change as artists edit; keep the file fresh rather than
// letting a build-time snapshot go stale.
export const revalidate = 3600

type GalleryRow = {
  slug: string
  updated_at: string | null
  profiles: { username: string | null } | null
}

/** One sitemap entry per locale for a page we author, each carrying the full
 *  hreflang set. Listing the alternates here as well as in the page's <head> is
 *  belt-and-braces: Google accepts either, and the sitemap is what it reads first
 *  for pages it has not crawled yet. */
function localized(
  base: string,
  path: string,
  rest: Omit<MetadataRoute.Sitemap[number], 'url' | 'alternates'>,
): MetadataRoute.Sitemap {
  const languages: Record<string, string> = {}
  for (const l of LOCALES) languages[LOCALE_META[l].bcp47] = `${base}${localePath(l, path)}`
  languages['x-default'] = `${base}${localePath(DEFAULT_LOCALE, path)}`
  return LOCALES.map((l) => ({
    url: `${base}${localePath(l, path)}`,
    ...rest,
    alternates: { languages },
  }))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    ...localized(base, '/', { lastModified: now, changeFrequency: 'weekly', priority: 1 }),
    ...localized(base, '/explore', { lastModified: now, changeFrequency: 'daily', priority: 0.9 }),
    ...localized(base, '/demo', { lastModified: now, changeFrequency: 'monthly', priority: 0.7 }),
    ...localized(base, '/articles', { lastModified: now, changeFrequency: 'weekly', priority: 0.6 }),
    // The three legal pages stay one URL each (docs/DECISIONS 2026-07-28 / 07-29):
    // English is the governing version of the Terms and the Privacy Policy, and the
    // 特商法 disclosure is Japanese law whose Japanese version is the operative one.
    { url: `${base}/legal`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]

  if (!supabase) return staticPages

  // A sitemap must never be the thing that breaks a deploy: if either query
  // fails we still serve the static pages rather than a 500.
  const galleriesQ = (async (): Promise<GalleryRow[]> => {
    try {
      const { data } = await supabase!
        .from('galleries')
        .select('slug, updated_at, profiles (username)')
        .eq('is_public', true)
      return (data ?? []) as unknown as GalleryRow[]
    } catch {
      return []
    }
  })()
  const articlesQ = fetchPublishedArticles().catch(() => [] as Awaited<ReturnType<typeof fetchPublishedArticles>>)
  const [galleries, articles] = await Promise.all([galleriesQ, articlesQ])

  // Group by artist first: with exactly one public gallery, `/@name` renders that
  // exhibition and `/@name/{slug}` is the same page again. Listing both — which this
  // file used to do — asks Google to index two URLs for one room. Only the canonical
  // goes in (docs/DECISIONS 2026-07-30 SEO); `lib/seo.ts` picks the same one.
  const byArtist = new Map<string, GalleryRow[]>()
  for (const g of galleries) {
    const username = g.profiles?.username
    if (!username || !g.slug) continue
    const list = byArtist.get(username)
    if (list) list.push(g)
    else byArtist.set(username, [g])
  }

  const artistPages: MetadataRoute.Sitemap = []
  const rooms: MetadataRoute.Sitemap = []
  for (const [username, rows] of byArtist) {
    const newest = rows.reduce<Date>((acc, g) => {
      const t = g.updated_at ? new Date(g.updated_at) : now
      return t > acc ? t : acc
    }, new Date(0))
    artistPages.push({
      url: `${base}/@${username}`,
      lastModified: newest,
      changeFrequency: 'weekly',
      priority: 0.8,
    })
    // The sole gallery's own URL is not canonical, so it stays out.
    if (rows.length === 1) continue
    for (const g of rows) {
      rooms.push({
        url: `${base}/@${username}/${g.slug}`,
        lastModified: g.updated_at ? new Date(g.updated_at) : now,
        changeFrequency: 'weekly',
        priority: 0.8,
      })
    }
  }

  return [
    ...staticPages,
    ...artistPages,
    ...rooms,
    ...articles.flatMap((a) =>
      localized(base, `/articles/${a.slug}`, {
        lastModified: a.publishedAt ? new Date(a.publishedAt) : now,
        changeFrequency: 'monthly' as const,
        priority: 0.5,
      }),
    ),
  ]
}
