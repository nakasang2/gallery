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

// Public galleries change as artists edit; keep the file fresh rather than
// letting a build-time snapshot go stale.
export const revalidate = 3600

type GalleryRow = {
  slug: string
  updated_at: string | null
  profiles: { username: string | null } | null
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/explore`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/demo`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/articles`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
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

  // An artist appears once, however many rooms they have open.
  const artists = new Set<string>()
  const rooms: MetadataRoute.Sitemap = []
  for (const g of galleries) {
    const username = g.profiles?.username
    if (!username || !g.slug) continue
    artists.add(username)
    rooms.push({
      url: `${base}/@${username}/${g.slug}`,
      lastModified: g.updated_at ? new Date(g.updated_at) : now,
      changeFrequency: 'weekly',
      priority: 0.8,
    })
  }

  return [
    ...staticPages,
    ...[...artists].map((u) => ({
      url: `${base}/@${u}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...rooms,
    ...articles.map((a) => ({
      url: `${base}/articles/${a.slug}`,
      lastModified: a.publishedAt ? new Date(a.publishedAt) : now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ]
}
