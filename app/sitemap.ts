// There was no sitemap, which for a service whose growth plan leans on search
// ("オンライン個展", "virtual gallery free" — docs/STRATEGY §4.1-3) meant every
// artist page depended on a crawler stumbling into it from Explore.
//
// Every URL here is already public and server-rendered; nothing private is
// listed (see app/robots.ts for what is explicitly kept out).
import type { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'
import { siteUrl } from '@/lib/publicUrl'
import { ARTICLE_LOCALE, fetchPublishedArticles } from '@/lib/blog'
import { DEFAULT_LOCALE, LOCALES, LOCALE_META, localePath } from '@/lib/i18n'
import { expoHostsEnabled, expoPath, expoUrl } from '@/lib/expoHost'

// Public galleries change as artists edit; keep the file fresh rather than
// letting a build-time snapshot go stale.
export const revalidate = 3600

type GalleryRow = {
  slug: string
  updated_at: string | null
  profiles: { username: string | null; expo_slug?: string | null } | null
  /** The front-door room, rendered at `/@name` (migration 0036). Absent on a database
   *  without 0036 — see the grouping below for what stands in then. */
  is_main?: boolean | null
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

/** The single URL a guide lives at. Kept in step with `singleLanguageAlternates`
 *  in the page's <head> — the sitemap and the canonical tag must name the same URL,
 *  or the sitemap is asking Google to index a page that disowns itself. */
function articleUrl(base: string, path: string): string {
  return `${base}${localePath(ARTICLE_LOCALE, path)}`
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    ...localized(base, '/', { lastModified: now, changeFrequency: 'weekly', priority: 1 }),
    ...localized(base, '/explore', { lastModified: now, changeFrequency: 'daily', priority: 0.9 }),
    ...localized(base, '/demo', { lastModified: now, changeFrequency: 'monthly', priority: 0.7 }),
    // Help/FAQ is genuinely translated (unlike the guides), so it lists one URL
    // per locale with the full hreflang set, same as /explore and /demo.
    ...localized(base, '/help', { lastModified: now, changeFrequency: 'monthly', priority: 0.4 }),
    // The guides are written once, in English (lib/blog ARTICLE_LOCALE), so they
    // get ONE URL each — not one per locale. `localized()` would list eleven URLs
    // claiming to be translations of each other, which is a claim the content
    // cannot back and which splits one article's signals eleven ways.
    { url: articleUrl(base, '/articles'), lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
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
      // `created_at` orders the rooms so the fallback front door (the oldest) is
      // identifiable when 0036 has not been applied.
      const { data, error } = await supabase!
        .from('galleries')
        .select('slug, updated_at, is_main, profiles (username, expo_slug)')
        .eq('is_public', true)
        .order('created_at', { ascending: true })
      if (!error) return (data ?? []) as unknown as GalleryRow[]
      const { data: legacy } = await supabase!
        .from('galleries')
        .select('slug, updated_at, profiles (username)')
        .eq('is_public', true)
        .order('created_at', { ascending: true })
      return (legacy ?? []) as unknown as GalleryRow[]
    } catch {
      return []
    }
  })()
  // 会期中の合同展示（migration 0044）。**部屋は上の問い合わせには入らない** ──
  // 合同展示の部屋は `is_public` を持てない（0045）ので、そこから拾う道が無い。
  // 主催者は場所代を払って会期を買っているので、その会期のあいだは索引に載せる。
  //
  // 猶予中（会期は終わったがURLは生きている）は載せない: そのページは「終了しました」と
  // 出すだけで、ページ側も `robots: noindex` を返す。sitemap と canonical/robots が
  // 食い違うのは、2026-07-30 のSEO整理が潰したのと同じ種類の間違い。
  const exposQ = (async (): Promise<{ id: string; slug: string; ends_at: string | null }[]> => {
    try {
      const { data, error } = await supabase!
        .from('expos')
        .select('id, slug, ends_at')
        .order('created_at', { ascending: true })
      // 0044 未適用（表が無い）なら「合同展示は無い」。sitemap は落とさない。
      if (error) return []
      const rows = (data ?? []) as { id: string; slug: string; ends_at: string | null }[]
      // RLS は猶予中のものも返すので、**会期そのものが生きているものだけ**に絞る。
      return rows.filter((x) => !!x.ends_at && new Date(x.ends_at).getTime() > Date.now())
    } catch {
      return []
    }
  })()
  const articlesQ = fetchPublishedArticles().catch(() => [] as Awaited<ReturnType<typeof fetchPublishedArticles>>)
  const [galleries, expos, articles] = await Promise.all([galleriesQ, exposQ, articlesQ])

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
    // An exhibition with a slug canonicalises to `/expo/{slug}`, so THAT is the URL to
    // list. Listing `/@name` as well would put a non-canonical duplicate in the sitemap —
    // the exact problem the SEO pass of 2026-07-30 fixed for `/@name` vs `/@name/{slug}`.
    const slug = rows.find((g) => g.profiles?.expo_slug)?.profiles?.expo_slug ?? null
    const artistBase = slug
      ? expoHostsEnabled
        ? expoUrl(slug)
        : `${base}${expoPath(slug)}`
      : `${base}/@${username}`
    artistPages.push({
      url: artistBase,
      lastModified: newest,
      changeFrequency: 'weekly',
      priority: 0.8,
    })
    // The front-door room is `/@name`, already listed above — its own
    // `/@name/{slug}` is the same page and is not canonical, so it stays out.
    // Which room that is comes from `is_main`, falling back to the oldest room the
    // same way `mainRoomOf()` does, so a pre-0036 database keeps the old behaviour
    // (one room → only `/@name` is listed).
    const frontSlug = (rows.find((g) => g.is_main) ?? rows[0])?.slug
    for (const g of rows) {
      if (g.slug === frontSlug) continue
      rooms.push({
        url: slug
          ? expoHostsEnabled
            ? expoUrl(slug, `/${g.slug}`)
            : `${base}${expoPath(slug, `/${g.slug}`)}`
          : `${base}/@${username}/${g.slug}`,
        lastModified: g.updated_at ? new Date(g.updated_at) : now,
        changeFrequency: 'weekly',
        priority: 0.8,
      })
    }
  }

  // 合同展示。ロビー（`/expo/{name}`）と、その中の部屋（`/expo/{name}/{room}`）。
  // 部屋も載せるのは、**扉が canvas の中にあってクローラは辿れない**から（plain-HTML
  // の控えは作品を出すが部屋のリンクは出さない）。載せなければロビーの1室しか索引に
  // 入らない。ロビーは `fetchExpoExhibition` と同じ「いちばん古い部屋」なので、
  // ロビー自身の `/expo/{name}/{room}` は canonical ではなく、ここには入れない。
  const expoPages: MetadataRoute.Sitemap = []
  if (expos.length) {
    // 会期中の展示の部屋を1度で引く。作成順なので、各展示の先頭がロビー
    // （`fetchExpoExhibition` と同じ根拠）。
    let expoRooms: { slug: string; updated_at: string | null; expo_id: string }[] = []
    try {
      const { data } = await supabase!
        .from('galleries')
        .select('slug, updated_at, expo_id')
        .in('expo_id', expos.map((x) => x.id))
        .order('created_at', { ascending: true })
      expoRooms = (data ?? []) as typeof expoRooms
    } catch {
      /* 部屋が引けなければロビーだけ載せる（sitemap は落とさない） */
    }
    for (const x of expos) {
      expoPages.push({
        url: `${base}/expo/${x.slug}`,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.8,
      })
      const mine = expoRooms.filter((r) => r.expo_id === x.id)
      for (const r of mine.slice(1)) {
        expoPages.push({
          url: `${base}/expo/${x.slug}/${r.slug}`,
          lastModified: r.updated_at ? new Date(r.updated_at) : now,
          changeFrequency: 'daily',
          priority: 0.7,
        })
      }
    }
  }

  return [
    ...staticPages,
    ...artistPages,
    ...rooms,
    ...expoPages,
    ...articles.map((a) => ({
      url: articleUrl(base, `/articles/${a.slug}`),
      lastModified: a.publishedAt ? new Date(a.publishedAt) : now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ]
}
