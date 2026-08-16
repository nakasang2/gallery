'use client'
// 2D list fallback (non-functional requirement: WebGL-unsupported environments and
// screen readers). Shows the same exhibition list as the 3D room, as plain scrollable articles.
//
// The markup itself lives in FlatWorkList, which the server also renders for
// crawlers (docs/DECISIONS 2026-07-30 SEO) — one implementation, so the two copies
// cannot drift apart.
import { useExhibitionList } from '@/lib/exhibition'
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle } from '@/lib/publish'
import { useT } from '@/components/I18nProvider'
import FlatWorkList from '@/components/gallery/FlatWorkList'

export default function FlatGallery({ onBackTo3d }: { onBackTo3d?: () => void }) {
  const t = useT()
  const list = useExhibitionList()
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const myGallery = useGallery((s) => s.myGallery)
  const ownerName = useGallery((s) => s.profileDisplayName)

  // Header identity mirrors the 3D HUD: a visitor sees the artist, a signed-in
  // owner sees their own room, and only the anonymous demo shows the house title.
  const owner = !visitor && user && myGallery
  const heading = visitor
    ? isPlaceholderTitle(visitor.title)
      ? visitor.ownerName
      : visitor.title
    : owner
      ? isPlaceholderTitle(myGallery!.title)
        ? ownerName || 'Your exhibition'
        : myGallery!.title
      : 'XIBIT360 COLLECTION'
  const subhead = visitor
    ? `${visitor.ownerName} — @${visitor.username}`
    : owner
      ? 'Your space'
      : 'A permanent collection — ten works'

  return (
    <>
      {/* WebGLはあるが自分の意思でここへ来た（U3のスキップリンク）ときだけ出す。
          WebGL非対応の環境では戻り先が無いので出さない。 */}
      {onBackTo3d && (
        <button type="button" className="flat-a11y-return" onClick={onBackTo3d}>
          {t('hud.backTo3d')}
        </button>
      )}
      <FlatWorkList
        heading={heading}
        subhead={subhead}
        statement={visitor?.statement || undefined}
        note={onBackTo3d ? undefined : t('artwork.noWebgl')}
        works={list}
        emptyNote={t('artwork.noWorks')}
      />
    </>
  )
}
