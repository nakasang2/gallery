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
  snsUrl,
  type PublicExhibition,
  type PublicProfile,
} from './publish'
import { siteUrl } from './publicUrl'
import { publicExhibitionWorks } from './roomPlan'
import type { ArtworkData } from './artworks'

/** Per-request memoised reads. `generateMetadata` and the page body both need the
 *  same exhibition, and before this they each fetched it — every crawl paid for two
 *  full reads of the gallery, its placements and its artworks. `cache()` keys on the
 *  arguments, so the second call inside one request is free. */
export const getExhibition = cache(fetchPublicExhibition)
export const getProfile = cache(fetchPublicProfile)

/* ---------------------------------- URLs ---------------------------------- */

export function artistPath(username: string): string {
  return `/@${username}`
}

/** The one URL that represents this exhibition. See the note at the top of the file. */
export function exhibitionPath(ex: PublicExhibition): string {
  return ex.publicGalleryCount === 1 ? artistPath(ex.username) : `/@${ex.username}/${ex.slug}`
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
  sns: { x: string; instagram: string; website: string }
}): Node {
  const sameAs = (['x', 'instagram', 'website'] as const)
    .filter((k) => p.sns[k])
    .map((k) => snsUrl(k, p.sns[k]))
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

/** One work. `VisualArtwork` with a real `image` is what puts a piece in front of
 *  someone searching images — which no artwork could be before, because the only
 *  place the files appeared was as a WebGL texture.
 *
 *  No `offers`: `price` is free text the artist typed in whatever currency and
 *  format they like ("Ask", "¥50,000"), and an Offer needs a machine-readable
 *  price. Claiming one from that string would be inventing data. */
function artworkNode(art: ArtworkData, pageUrl: string, personId: string): Node {
  const image = absoluteMedia(art.kind === 'video' ? art.poster ?? art.src : art.src)
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
    ...(image ? { image } : {}),
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
  const cover =
    works.find((w) => w.id === ex.coverArtworkId) ?? works[0]
  const coverImage = absoluteMedia(cover ? (cover.kind === 'video' ? cover.poster : cover.card ?? cover.src) : undefined)
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
        inLanguage: 'en',
        isPartOf: { '@id': website()['@id'] },
        about: { '@id': personId },
        ...(coverImage ? { primaryImageOfPage: coverImage } : {}),
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
      breadcrumbNode(
        ex.publicGalleryCount === 1
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
        inLanguage: 'en',
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
            ...(image ? { primaryImageOfPage: image } : {}),
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
