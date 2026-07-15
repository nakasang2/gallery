// Printable exhibition catalog: /@username/slug/catalog
// A static, print-optimised view (cover + one section per work) that the artist
// saves as a PDF via the browser's print dialog — no PDF library, no server
// rendering of images. Useful for degree shows, job applications and press kits.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { fetchPublicExhibition, isPlaceholderTitle } from '@/lib/publish'
import CatalogPrintButton from '@/components/CatalogPrintButton'
import CatalogDoc from '@/components/CatalogDoc'

export const dynamic = 'force-dynamic'

async function resolveParams(params: Promise<{ handle: string; slug: string }>) {
  const { handle, slug } = await params
  const decoded = decodeURIComponent(handle)
  if (!decoded.startsWith('@')) return null
  return { username: decoded.slice(1), slug }
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
  const name = isPlaceholderTitle(ex.title) ? ex.ownerName : ex.title
  return { title: `${name} — Catalog | HAKONIWA`, robots: { index: false } }
}

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const p = await resolveParams(params)
  if (!p) notFound()
  const ex = await fetchPublicExhibition(p.username, p.slug)
  if (!ex) notFound()

  return (
    <main className="catalog">
      {/* Screen-only toolbar (hidden when printing) */}
      <div className="catalog-toolbar">
        <Link href={`/@${ex.username}/${ex.slug}`} className="catalog-back">← Back to the gallery</Link>
        <CatalogPrintButton />
      </div>
      <CatalogDoc exhibition={ex} />
    </main>
  )
}
