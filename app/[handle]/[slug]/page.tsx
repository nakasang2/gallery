// Public gallery: hakoniwa.app/@username/slug
// Fetch the exhibition data server-side to attach OGP tags; leave the 3D rendering to the client
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fetchPublicExhibition } from '@/lib/publish'
import VisitorGallery from '@/components/gallery/VisitorGallery'

// Always fetch the latest from Supabase (so changes appear right after publishing)
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
    ex.statement || `A 3D gallery by ${ex.ownerName}. Walk through ${ex.artworks.length} works in your browser.`
  const first = ex.artworks[0]
  const firstImage = first ? (first.kind === 'video' ? first.poster : first.src) : undefined
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
