// An exhibition at its own URL: `xibit360.art/expo/tokyo-geidai-2026`
// (ユーザー決定 2026-08-09).
//
// Chosen over a subdomain because a subdomain costs a Vercel domain and a DNS record
// PER EXHIBITION, by hand, against a 50-domain cap — work that grows with the number of
// shows. A path costs nothing per show. Chosen over the root (`/{slug}`) because the
// root already holds fourteen app routes and eleven locale codes, and would keep
// colliding with every route added later; `/expo/` also tells a visitor what the page is.
//
// **この URL には住人が2種類いる**（0045 の注記と同じ話）:
//   ①**合同展示**（`expos.slug`。migration 0044）— 会期があり、主催者が場所代を払って
//     いる。部屋は `expo_id` でぶら下がり、`is_public` を持たない。
//   ②**アカウントの別名**（`profiles.expo_slug`。migration 0040）— 管理者が付ける恒久的な
//     別名。中身は `/@ハンドル` と同じ「その作家の玄関の部屋」。
//
// 先に①を見る。名前がぶつかることは 0045 のトリガが両方向で塞いだので、**両方に同じ
// 名前が居るのは 0045 より前に作られたものだけ**（0045 の末尾がその場合 NOTICE を出す）。
// その時に会期中の展示を優先するのは、そちらが**お金を払って配ったURL**だから。
//
// No listing fallback. `/@username` shows an artist page when nothing is published; an
// exhibition URL with nothing to exhibit is a 404, which is the honest answer for a URL
// handed out before the show opened — 会期前・会期＋猶予後もこれに含まれる（DBが行を
// 返さないので、ここは「無い」しか受け取らない）。
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import VisitorGallery from '@/components/gallery/VisitorGallery'
import JsonLd from '@/components/JsonLd'
import {
  exhibitionDescription,
  exhibitionJsonLd,
  exhibitionTitle,
  exhibitionUrl,
  resolveExpoLobby,
} from '@/lib/seo'

export const dynamic = 'force-dynamic'

/** slug → 会期中の合同展示のロビー、無ければアカウント別名の玄関の部屋、無ければ null。
 *  `resolveExpoLobby`（lib/seo.ts）は `opengraph-image.tsx` とも共有する。 */
async function resolve(params: Promise<{ slug: string }>) {
  const { slug } = await params
  return resolveExpoLobby(slug)
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const ex = await resolve(params)
  if (!ex) return {}
  const title = exhibitionTitle(ex)
  const description = exhibitionDescription(ex)
  // `/expo/{slug}` IS the canonical for an exhibition that has a slug, so this agrees
  // with what `/@username` says about the same room.
  const canonical = exhibitionUrl(ex)
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: 'website', url: canonical },
    twitter: { card: 'summary_large_image' },
    // 会期が終わった合同展示は**猶予のあいだ「終了しました」を出すだけ**のページになる。
    // そこに検索から人を送っても得るものが無いので、索引から外す（URLは生きている ──
    // 配ったリンクを死なせないための猶予なので）。
    ...(ex.expo?.hasEnded ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function ExpoLobbyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
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
