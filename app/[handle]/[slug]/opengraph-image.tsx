// OGP card for a public exhibition: cover work + title + artist (ARCHITECTURE step 3 follow-up)
import { fetchPublicExhibition } from '@/lib/publish'
import { exhibitionOgImage, OG_IMAGE_SIZE } from '@/lib/ogImage'

export const size = OG_IMAGE_SIZE
export const contentType = 'image/png'
export const alt = 'Xibit360 — a walkable 3D exhibition'

export default async function OgImage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle, slug } = await params
  const username = decodeURIComponent(handle).replace(/^@/, '')
  const ex = await fetchPublicExhibition(username, slug)
  return exhibitionOgImage(ex)
}
