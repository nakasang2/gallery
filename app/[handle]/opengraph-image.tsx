// OGP card for /@username — the exhibition card when a single public gallery
// makes this URL the room itself, otherwise a profile card
import { fetchPublicProfile, fetchPublicExhibition, isPlaceholderTitle } from '@/lib/publish'
import { absoluteMedia } from '@/lib/seo'
import { renderOgCard, OG_IMAGE_SIZE } from '@/lib/ogImage'

export const size = OG_IMAGE_SIZE
export const contentType = 'image/png'
export const alt = 'Xibit360 — a walkable 3D exhibition'

export default async function OgImage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const username = decodeURIComponent(handle).replace(/^@/, '')
  const p = await fetchPublicProfile(username)

  let heading = 'A walkable 3D exhibition'
  let sub: string | undefined
  let note = 'Your work, given space.'
  let cover: string | undefined

  if (p && p.galleries.length === 1) {
    const ex = await fetchPublicExhibition(username, p.galleries[0].slug)
    if (ex) {
      const first = ex.artworks.find((a) => a.id === ex.coverArtworkId) ?? ex.artworks[0]
      // `absoluteMedia` refuses a relative path instead of handing it to
      // ImageResponse, which throws on one and takes the whole card down
      // (リリース前監査 #16).
      cover = first ? absoluteMedia(first.kind === 'video' ? first.poster : first.src) : undefined
      heading = isPlaceholderTitle(ex.title) ? ex.ownerName : ex.title
      sub = isPlaceholderTitle(ex.title) ? `@${ex.username}` : `by ${ex.ownerName}`
      note = `Walk through ${ex.artworks.length} work${ex.artworks.length === 1 ? '' : 's'} in your browser →`
    }
  } else if (p) {
    cover = absoluteMedia(p.galleries.find((g) => g.cover)?.cover)
    heading = p.displayName
    sub = `@${p.username}`
    note = 'Walkable 3D galleries →'
  }

  return renderOgCard({ cover, heading, sub, note })
}
