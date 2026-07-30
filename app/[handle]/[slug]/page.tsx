// Public gallery: xibit360.art/@username/slug
// Fetch the exhibition data server-side to attach OGP tags; leave the 3D rendering to the client
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import VisitorGallery from '@/components/gallery/VisitorGallery'
import JsonLd from '@/components/JsonLd'
import {
  exhibitionDescription,
  exhibitionJsonLd,
  exhibitionPath,
  exhibitionTitle,
  getExhibition,
} from '@/lib/seo'

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
  const ex = await getExhibition(p.username, p.slug)
  if (!ex) return {}
  const title = exhibitionTitle(ex)
  const description = exhibitionDescription(ex)
  // While this is the artist's only public gallery, `/@name` renders this very
  // exhibition, so the canonical points there and the two URLs stop competing
  // (docs/DECISIONS 2026-07-30 SEO). It also collapses `?embed=1`, which is the
  // same page again with the HUD stripped for iframes.
  const canonical = exhibitionPath(ex)
  // OG image comes from the opengraph-image.tsx file convention (a composed card)
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: 'website', url: canonical },
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
  const ex = await getExhibition(p.username, p.slug)
  if (!ex) notFound()
  const { embed } = await searchParams
  return (
    <>
      <JsonLd data={exhibitionJsonLd(ex)} />
      <VisitorGallery exhibition={ex} embed={embed === '1'} />
    </>
  )
}
