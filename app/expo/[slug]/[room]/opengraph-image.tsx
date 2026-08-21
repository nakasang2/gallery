// OGP card for a single room inside a joint exhibition (リリース前監査 #17).
// Shares lib/ogImage.tsx's card body and lib/seo.ts's `resolveExpoRoom`.
import { resolveExpoRoom } from '@/lib/seo'
import { exhibitionOgImage, OG_IMAGE_SIZE } from '@/lib/ogImage'

export const size = OG_IMAGE_SIZE
export const contentType = 'image/png'
export const alt = 'Xibit360 — a walkable 3D exhibition'

export default async function OgImage({
  params,
}: {
  params: Promise<{ slug: string; room: string }>
}) {
  const { slug, room } = await params
  const ex = await resolveExpoRoom(slug, room)
  return exhibitionOgImage(ex)
}
