// Everything the public pages tell a search engine about an artist and their
// exhibitions (docs/DECISIONS 2026-07-30 SEO).
//
// Two jobs live here:
//
//   1. Canonical URLs. `/@name` and `/@name/slug` render the SAME page while the
//      artist has exactly one gallery open, and both were in the sitemap with no
//      canonical between them — so the two URLs competed for one exhibition. The
//      canonical is `/@name`: it is the URL artists actually hand out, so it is
//      where the links point. Publishing a second gallery turns `/@name` into a
//      listing, and each `/@name/slug` becomes canonical for itself.
//
//   2. Structured data. The exhibition itself lives inside a WebGL canvas, so a
//      crawler that runs JS finds a <canvas> and nothing else to read. JSON-LD is
//      how the works, their media and the artist reach that crawler — it stays in
//      the HTML, unlike the plain-HTML fallback list, which hydration removes.
//
// The prose here is English on purpose: these pages have a single URL that carries
// no locale, and DECISIONS 2026-07-29 keeps single-URL pages English rather than
// letting a cookie decide which language gets indexed. That is the same call the
// existing page titles already made; localising it needs locale-prefixed URLs for
// public galleries (the C option, deliberately not taken).
import { cache } from 'react'
import {
  fetchPublicExhibition,
  fetchPublicProfile,
  isPlaceholderTitle,
  type PublicExhibition,
  type PublicProfile,
} from './publish'
import { allSnsUrls, type SnsLinks } from './sns'
import { ARTICLE_LOCALE, fetchArticle, type Article, type ArticleCard } from './blog'
import { LOCALE_META, localePath } from './i18n'
import { siteUrl } from './publicUrl'
import { publicExhibitionWorks } from './roomPlan'
import type { ArtworkData } from './artworks'

/** Per-request memoised reads. `generateMetadata` and the page body both need the
 *  same exhibition, and before this they each fetched it — every crawl paid for two
 *  full reads of the gallery, its placements and its artworks. `cache()` keys on the
 *  arguments, so the second call inside one request is free. */
export const getExhibition = cache(fetchPublicExhibition)
export const getProfile = cache(fetchPublicProfile)
/** Same deal for a guide: `generateMetadata` and the page body both read it. */
export const getArticle = cache(fetchArticle)

/* ---------------------------------- URLs ---------------------------------- */

export function artistPath(username: string): string {
  return `/@${username}`
}

/** The one URL that represents this exhibition. See the note at the top of the file.
 *
 *  `/@name` renders the FRONT-DOOR room, so that room's canonical is `/@name` and the
 *  two URLs stop competing. Every other room is a page of its own with its own works,
 *  so it canonicalises to its own `/@name/[slug]` (ユーザー決定 2026-08-09: multi-room
 *  keeps ONE artist URL, with the sub-rooms hanging underneath it). This used to key
 *  off `publicGalleryCount === 1`, which said the same thing back when one room was
 *  the only possibility. */
export function exhibitionPath(ex: PublicExhibition): string {
  return ex.isMain ? artistPath(ex.username) : `/@${ex.username}/${ex.slug}`
}

function abs(path: string): string {
  return `${siteUrl()}${path}`
}

/** Keep relative media out of the structured data: an unconfigured CDN base makes
 *  `publicUrl()` return a site-relative path, and a relative `image` is worse than
 *  no `image` (the crawler resolves it against the wrong origin). */
function absoluteMedia(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

/* ------------------------------ Title / summary ---------------------------- */

/** Shown as the <title> and reused as the structured-data name, so the two agree. */
export function exhibitionTitle(ex: PublicExhibition): string {
  return isPlaceholderTitle(ex.title)
    ? `${ex.ownerName} — Xibit360`
    : `${ex.title} | ${ex.ownerName} — Xibit360`
}

/** The <meta name="description">, which is the sentence a searcher actually reads
 *  under the link. The artist's own statement when they wrote one.
 *
 *  The fallback counts, so it has to inflect: this read "Walk through 1 works" for
 *  every artist showing a single piece, and "0 works" for an empty room — the same
 *  class of bug the dictionary was fixed for on 2026-07-29, still living here
 *  because these single-URL pages are English by decision and never went through
 *  `translate()`. */
export function exhibitionDescription(ex: PublicExhibition): string {
  if (ex.statement) return ex.statement
  const n = ex.artworks.length
  const walk =
    n === 0
      ? 'Step inside and walk the room in your browser.'
      : `Walk through ${n} ${n === 1 ? 'work' : 'works'} in your browser.`
  return `A 3D gallery by ${ex.ownerName}. ${walk}`
}

/* ----------------------------- Structured data ----------------------------- */

type Node = Record<string, unknown>

function personNode(p: {
  username: string
  displayName: string
  bio: string
  avatarUrl: string | null
  sns: SnsLinks
}): Node {
  const sameAs = allSnsUrls(p.sns)
  const image = absoluteMedia(p.avatarUrl)
  return {
    '@type': 'Person',
    '@id': `${abs(artistPath(p.username))}#person`,
    name: p.displayName,
    url: abs(artistPath(p.username)),
    ...(p.bio ? { description: p.bio } : {}),
    ...(image ? { image } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }
}

/** The work's image, with who made it attached.
 *
 *  A bare URL says "here is a picture". An `ImageObject` carrying `creator`,
 *  `creditText` and `copyrightNotice` is what lets Google Images show the artist's
 *  name next to their own work — which matters more here than on most sites,
 *  because the whole product is other people's art being found by strangers.
 *
 *  Every field is derived from data we actually hold. `copyrightNotice` names the
 *  artist because the Terms §3 say so in as many words ("You keep all rights to the
 *  works you upload"), so this is repeating our own agreement, not deciding it.
 *
 *  Deliberately absent:
 *  - `license` / `acquireLicensePage`, which are what Google's "Licensable" badge
 *    needs. Only the artist knows the terms on which their work may be licensed,
 *    and there is no field for it yet. A site-wide URL here would tell searchers
 *    these images are licensable on terms nobody has agreed to.
 *  - pixel `width` / `height`. `contentUrl` is the resized derivative, while the
 *    dimensions we store are the original's — declaring one for the other would be
 *    precisely wrong rather than merely missing. */
/** The file we point a crawler at for this work — the poster frame for a video,
 *  the display image otherwise. `undefined` when it is not an absolute URL. */
function workImageUrl(art: ArtworkData): string | undefined {
  return absoluteMedia(art.kind === 'video' ? art.poster ?? art.src : art.src)
}

function imageNode(art: ArtworkData, url: string, pageUrl: string, personId: string): Node {
  return {
    '@type': 'ImageObject',
    '@id': `${pageUrl}#image-${art.id}`,
    contentUrl: url,
    creator: { '@id': personId },
    creditText: art.artist,
    ...(art.year ? { copyrightNotice: `© ${art.year} ${art.artist}` } : {}),
  }
}

/** One work. `VisualArtwork` with a real `image` is what puts a piece in front of
 *  someone searching images — which no artwork could be before, because the only
 *  place the files appeared was as a WebGL texture.
 *
 *  No `offers`: `price` is free text the artist typed in whatever currency and
 *  format they like ("Ask", "¥50,000"), and an Offer needs a machine-readable
 *  price. Claiming one from that string would be inventing data. */
function artworkNode(art: ArtworkData, pageUrl: string, personId: string): Node {
  const image = workImageUrl(art)
  const cm = (v: number) => ({ '@type': 'QuantitativeValue', value: v, unitCode: 'CMT' })
  return {
    '@type': 'VisualArtwork',
    '@id': `${pageUrl}#work-${art.id}`,
    name: art.title,
    ...(art.desc ? { description: art.desc } : {}),
    ...(art.year ? { dateCreated: String(art.year) } : {}),
    ...(art.medium ? { artMedium: art.medium } : {}),
    ...(art.widthCm ? { width: cm(art.widthCm) } : {}),
    ...(art.heightCm ? { height: cm(art.heightCm) } : {}),
    ...(image ? { image: imageNode(art, image, pageUrl, personId) } : {}),
    creator: { '@id': personId },
    isPartOf: { '@id': `${pageUrl}#page` },
  }
}

function breadcrumbNode(trail: { name: string; path: string }[]): Node {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: abs(t.path),
    })),
  }
}

function website(): Node {
  return { '@type': 'WebSite', '@id': `${siteUrl()}/#website`, name: 'Xibit360', url: `${siteUrl()}/` }
}

/** Us, as the publisher and author of the guides.
 *
 *  No `logo`: there is no logo file on this site to point at (the wordmark is set
 *  in type), and a URL that 404s is worse than an absent property. Google dropped
 *  the hard `publisher.logo` requirement for article results, so this stays honest
 *  rather than complete. */
function organization(): Node {
  return { '@type': 'Organization', '@id': `${siteUrl()}/#org`, name: 'Xibit360', url: `${siteUrl()}/` }
}

/* -------------------------------- Guides ---------------------------------- */

/** The one URL a guide lives at — the same one the canonical tag and the sitemap
 *  name (docs/DECISIONS 2026-07-31). Structured data that points anywhere else
 *  describes a page Google is not indexing. */
function guidePath(slug?: string): string {
  return localePath(ARTICLE_LOCALE, slug ? `/articles/${slug}` : '/articles')
}

function blogNode(): Node {
  const url = abs(guidePath())
  return {
    '@type': 'Blog',
    '@id': `${url}#blog`,
    url,
    name: 'Xibit360 Guides',
    inLanguage: LOCALE_META[ARTICLE_LOCALE].bcp47,
    isPartOf: { '@id': website()['@id'] },
    publisher: { '@id': organization()['@id'] },
  }
}

/** A guide as a `BlogPosting`. Used whole on the guide's own page and inline in
 *  the index's `blogPost` list, so both pages describe the same entity (`@id`).
 *
 *  `inLanguage` is stated here, unlike the exhibition graph where it was removed
 *  (LESSONS 2026-07-30): an exhibition's text is whatever the artist wrote and we
 *  cannot know it, but a guide is English by construction (`ARTICLE_LOCALE`). */
function blogPostingNode(a: {
  slug: string
  title: string
  excerpt: string
  coverUrl: string | null
  publishedAt: string | null
  updatedAt?: string | null
}): Node {
  const url = abs(guidePath(a.slug))
  const image = absoluteMedia(a.coverUrl)
  return {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    url,
    mainEntityOfPage: url,
    // Google may drop an article from rich results when the headline runs past
    // ~110 characters. Not truncated here on purpose: a shortened headline is a
    // different title from the one on the page, and disagreeing with the page is
    // the failure mode structured data is supposed to avoid.
    headline: a.title,
    ...(a.excerpt ? { description: a.excerpt } : {}),
    inLanguage: LOCALE_META[ARTICLE_LOCALE].bcp47,
    ...(a.publishedAt ? { datePublished: a.publishedAt } : {}),
    ...(a.updatedAt ? { dateModified: a.updatedAt } : {}),
    ...(image ? { image: [image] } : {}),
    // The guides are written and published by us through the admin console —
    // there is no per-author field, and inventing one would be a claim we cannot back.
    author: { '@id': organization()['@id'] },
    publisher: { '@id': organization()['@id'] },
    isPartOf: { '@id': blogNode()['@id'] },
  }
}

/** The graph for one guide (`/en/articles/{slug}`). */
export function articleJsonLd(a: Article): Node {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      blogPostingNode(a),
      blogNode(),
      organization(),
      website(),
      breadcrumbNode([
        { name: 'Xibit360', path: '/' },
        { name: 'Guides', path: guidePath() },
        { name: a.title, path: guidePath(a.slug) },
      ]),
    ],
  }
}

/** The graph for the guides index (`/en/articles`). The posts are inlined rather
 *  than referenced by `@id` alone, so the index carries no dangling references to
 *  nodes that only exist on another page. */
export function articlesIndexJsonLd(list: ArticleCard[]): Node {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { ...blogNode(), blogPost: list.map(blogPostingNode) },
      organization(),
      website(),
      breadcrumbNode([
        { name: 'Xibit360', path: '/' },
        { name: 'Guides', path: guidePath() },
      ]),
    ],
  }
}

/** The graph for a published exhibition, whichever of its two URLs served it.
 *  `CollectionPage` + `ItemList` rather than `ExhibitionEvent`: an event needs a
 *  `startDate` to be valid, and a gallery that is simply always open has none —
 *  claiming one would trade a real omission for a wrong answer. */
export function exhibitionJsonLd(ex: PublicExhibition): Node {
  const pageUrl = abs(exhibitionPath(ex))
  const person = personNode({
    username: ex.username,
    displayName: ex.ownerName,
    bio: ex.ownerBio,
    avatarUrl: ex.ownerAvatar,
    sns: ex.ownerSns,
  })
  const personId = person['@id'] as string
  // Slot order — the same order the room hangs them in, and the same list the
  // plain-HTML fallback prints. Works past the room's capacity are not exhibited.
  const works = publicExhibitionWorks(ex)
  // `primaryImageOfPage` expects an ImageObject, NOT a URL — unlike `image`, which
  // takes either. Handing it a bare string made validators read the URL as the
  // object's `name`, so the cover was the one image on the page that did not count
  // as an image at all. Reference the cover work's own node instead: it exists
  // already and carries the artist's credit, so there is nothing to keep in sync.
  const cover = works.find((w) => w.id === ex.coverArtworkId) ?? works[0]
  // Only when that node was actually emitted — a work whose media is not an
  // absolute URL has no ImageObject, and a dangling @id is worse than no cover.
  const coverImageId = cover && workImageUrl(cover) ? `${pageUrl}#image-${cover.id}` : undefined
  const name = isPlaceholderTitle(ex.title) ? ex.ownerName : ex.title

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${pageUrl}#page`,
        url: pageUrl,
        name,
        description: exhibitionDescription(ex),
        // No `inLanguage`. The name and description are whatever the artist wrote —
        // the first real gallery to carry this had a Japanese statement — while the
        // page chrome renders in the visitor's locale. There is no one language to
        // declare, and declaring the wrong one is worse than declaring none.
        isPartOf: { '@id': website()['@id'] },
        about: { '@id': personId },
        ...(coverImageId ? { primaryImageOfPage: { '@id': coverImageId } } : {}),
        mainEntity: { '@id': `${pageUrl}#works` },
      },
      {
        '@type': 'ItemList',
        '@id': `${pageUrl}#works`,
        name,
        numberOfItems: works.length,
        itemListOrder: 'https://schema.org/ItemListOrderAscending',
        itemListElement: works.map((art, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: artworkNode(art, pageUrl, personId),
        })),
      },
      person,
      website(),
      // The front-door room IS `/@name`, so its trail stops there; a sub-room adds
      // itself as a third crumb under the artist.
      breadcrumbNode(
        ex.isMain
          ? [
              { name: 'Xibit360', path: '/' },
              { name: ex.ownerName, path: artistPath(ex.username) },
            ]
          : [
              { name: 'Xibit360', path: '/' },
              { name: ex.ownerName, path: artistPath(ex.username) },
              { name, path: `/@${ex.username}/${ex.slug}` },
            ],
      ),
    ],
  }
}

/** The graph for `/@name` when it is a LISTING (two or more public galleries).
 *  With exactly one gallery the page is the exhibition, so it uses the graph above. */
export function artistJsonLd(p: PublicProfile): Node {
  const pageUrl = abs(artistPath(p.username))
  const person = personNode({
    username: p.username,
    displayName: p.displayName,
    bio: p.bio,
    avatarUrl: p.avatarUrl,
    sns: p.sns,
  })
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfilePage',
        '@id': `${pageUrl}#page`,
        url: pageUrl,
        name: `${p.displayName} — Xibit360`,
        ...(p.bio ? { description: p.bio } : {}),
        // See the note on the exhibition graph: the bio is the artist's own words.
        isPartOf: { '@id': website()['@id'] },
        mainEntity: { '@id': person['@id'] },
        hasPart: p.galleries.map((g) => {
          const image = absoluteMedia(g.cover)
          return {
            '@type': 'CollectionPage',
            '@id': `${abs(`/@${p.username}/${g.slug}`)}#page`,
            url: abs(`/@${p.username}/${g.slug}`),
            name: isPlaceholderTitle(g.title) ? p.displayName : g.title,
            ...(g.statement ? { description: g.statement } : {}),
            // A full ImageObject, not the URL — see the note in exhibitionJsonLd.
            // This page has no per-work nodes to point at, so it carries its own,
            // credited the same way the works on the exhibition page are.
            ...(image
              ? {
                  primaryImageOfPage: {
                    '@type': 'ImageObject',
                    '@id': `${abs(`/@${p.username}/${g.slug}`)}#cover`,
                    contentUrl: image,
                    creator: { '@id': person['@id'] },
                    creditText: p.displayName,
                  },
                }
              : {}),
            about: { '@id': person['@id'] },
          }
        }),
      },
      person,
      website(),
      breadcrumbNode([
        { name: 'Xibit360', path: '/' },
        { name: p.displayName, path: artistPath(p.username) },
      ]),
    ],
  }
}
