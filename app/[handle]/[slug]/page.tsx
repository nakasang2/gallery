// 公開ギャラリー: hakoniwa.app/@username/slug
// サーバー側で展示データを取得して OGP を付与し、3D表示はクライアントに任せる
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fetchPublicExhibition } from '@/lib/publish'
import VisitorGallery from '@/components/gallery/VisitorGallery'

// Supabase から毎回最新を取得する(公開直後に反映されるように)
export const dynamic = 'force-dynamic'

async function resolveParams(params: Promise<{ handle: string; slug: string }>) {
  const { handle, slug } = await params
  const decoded = decodeURIComponent(handle)
  if (!decoded.startsWith('@')) return null
  const username = decoded.slice(1)
  return { username, slug }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}): Promise<Metadata> {
  const p = await resolveParams(params)
  if (!p) return {}
  const ex = await fetchPublicExhibition(p.username, p.slug)
  if (!ex) return {}
  const title = `${ex.title} | ${ex.ownerName} — HAKONIWA`
  const description =
    ex.statement || `${ex.ownerName} の3Dギャラリー。${ex.artworks.length}点の作品を歩いて鑑賞できます。`
  const firstImage = ex.artworks[0]?.src
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      ...(firstImage ? { images: [{ url: firstImage }] } : {}),
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function PublicGalleryPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const p = await resolveParams(params)
  if (!p) notFound()
  const ex = await fetchPublicExhibition(p.username, p.slug)
  if (!ex) notFound()
  return <VisitorGallery exhibition={ex} />
}
