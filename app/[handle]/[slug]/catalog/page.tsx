// Printable exhibition catalog: /@username/slug/catalog
// A static, print-optimised view (cover + one section per work) that the artist
// saves as a PDF via the browser's print dialog — no PDF library, no server
// rendering of images. Useful for degree shows, job applications and press kits.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlaceholderTitle } from '@/lib/publish'
import { getExhibition } from '@/lib/seo'
import CatalogPrintButton from '@/components/CatalogPrintButton'
import CatalogDoc from '@/components/CatalogDoc'
import { getServerT } from '@/lib/i18n/server'

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
  const ex = await getExhibition(p.username, p.slug)
  if (!ex) return {}
  const name = isPlaceholderTitle(ex.title) ? ex.ownerName : ex.title
  return { title: `${name} — Catalog | Xibit360`, robots: { index: false } }
}

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { t } = await getServerT()
  const p = await resolveParams(params)
  if (!p) notFound()
  const ex = await getExhibition(p.username, p.slug)
  if (!ex) notFound()

  return (
    <main className="catalog">
      {/* Screen-only toolbar (hidden when printing) */}
      <div className="catalog-toolbar">
        <Link href={`/@${ex.username}/${ex.slug}`} className="catalog-back">{t('catalog.back')}</Link>
        <CatalogPrintButton />
      </div>
      <CatalogDoc exhibition={ex} />
    </main>
  )
}
