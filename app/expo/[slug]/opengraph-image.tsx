// OGP card for a joint exhibition's lobby (リリース前監査 #17 — this page had none
// at all). Shares the same card body as `/@handle/[slug]` (lib/ogImage.tsx) and the
// same slug resolution as the page itself (lib/seo.ts `resolveExpoLobby`).
import { resolveExpoLobby } from '@/lib/seo'
import { exhibitionOgImage, OG_IMAGE_SIZE } from '@/lib/ogImage'

export const size = OG_IMAGE_SIZE
export const contentType = 'image/png'
export const alt = 'Xibit360 — a walkable 3D exhibition'

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ex = await resolveExpoLobby(slug)
  return exhibitionOgImage(ex)
}
