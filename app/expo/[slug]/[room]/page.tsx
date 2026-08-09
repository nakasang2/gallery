// One room of an exhibition: `xibit360.art/expo/tokyo-geidai-2026/painting`.
// See ../page.tsx for why this URL shape was chosen and why there is no listing fallback.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import VisitorGallery from '@/components/gallery/VisitorGallery'
import JsonLd from '@/components/JsonLd'
import {
  exhibitionDescription,
  exhibitionJsonLd,
  exhibitionTitle,
  exhibitionUrl,
  getExhibition,
} from '@/lib/seo'
import { getUsernameForExpoSlug } from '@/lib/expoResolve'

export const dynamic = 'force-dynamic'

async function resolve(params: Promise<{ slug: string; room: string }>) {
  const { slug, room } = await params
  const username = await getUsernameForExpoSlug(slug)
  if (!username) return null
  return (await getExhibition(username, room)) ?? null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; room: string }>
}): Promise<Metadata> {
  const ex = await resolve(params)
  if (!ex) return {}
  const title = exhibitionTitle(ex)
  const description = exhibitionDescription(ex)
  const canonical = exhibitionUrl(ex)
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: 'website', url: canonical },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function ExpoRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; room: string }>
  searchParams: Promise<{ embed?: string }>
}) {
  const ex = await resolve(params)
  if (!ex) notFound()
  const { embed } = await searchParams
  return (
    <>
      <JsonLd data={exhibitionJsonLd(ex)} />
      <VisitorGallery exhibition={ex} embed={embed === '1'} />
    </>
  )
}
