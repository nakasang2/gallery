// Public gallery: xibit360.art/@username/slug
// Fetch the exhibition data server-side to attach OGP tags; leave the 3D rendering to the client
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fetchPublicExhibition, isPlaceholderTitle } from '@/lib/publish'
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
  const title = isPlaceholderTitle(ex.title)
    ? `${ex.ownerName} — Xibit360`
    : `${ex.title} | ${ex.ownerName} — Xibit360`
  const description =
    ex.statement || `A 3D gallery by ${ex.ownerName}. Walk through ${ex.artworks.length} works in your browser.`
  // OG image comes from the opengraph-image.tsx file convention (a composed card)
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function PublicGalleryPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ embed?: string }>
}) {
  const p = await resolveParams(params)
  if (!p) notFound()
  const ex = await fetchPublicExhibition(p.username, p.slug)
  if (!ex) notFound()
  const { embed } = await searchParams
  return <VisitorGallery exhibition={ex} embed={embed === '1'} />
}
