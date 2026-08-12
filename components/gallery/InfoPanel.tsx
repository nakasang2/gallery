'use client'
// Exhibition-info panel — the "detail UI" for the title wall (opened by clicking it),
// the board's counterpart to the per-work ArtworkPanel. Reuses the .panel drawer.
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle, EMPTY_SNS, type SnsLinks as SnsLinksData } from '@/lib/publish'
import { roomExhibitor } from '@/lib/roomPlan'
import { DEFAULT_TITLE_TEXT } from './textures'
import { useT } from '@/components/I18nProvider'
import SnsLinks from '@/components/SnsLinks'

export default function InfoPanel() {
  const t = useT()
  const infoOpen = useGallery((s) => s.infoOpen)
  const setInfoOpen = useGallery((s) => s.setInfoOpen)
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const myGallery = useGallery((s) => s.myGallery)
  const displayName = useGallery((s) => s.profileDisplayName)
  const bio = useGallery((s) => s.profileBio)

  const eyebrow = 'Exhibition'
  // Defaults are the /demo board copy; visitor / owner override with their own
  let title = DEFAULT_TITLE_TEXT.title
  let exhibitor = ''
  let statement = DEFAULT_TITLE_TEXT.statement ?? ''
  let artistBio = ''
  let sns: SnsLinksData = EMPTY_SNS

  if (visitor) {
    // Same derivation as the board it belongs to (lib/roomPlan.roomExhibitor): the
    // artist when this room is theirs alone, the collective when the walls are mixed.
    const by = roomExhibitor(visitor)
    title = isPlaceholderTitle(visitor.title) ? by.name : visitor.title
    exhibitor = by.name
    statement = visitor.statement
    artistBio = by.bio
    sns = by.sns
  } else if (user && myGallery) {
    title = isPlaceholderTitle(myGallery.title) ? displayName || 'Your exhibition' : myGallery.title
    exhibitor = displayName || ''
    statement = myGallery.statement
    artistBio = bio ?? ''
  }

  return (
    <aside id="info-panel" className={`panel${infoOpen ? ' open' : ''}`} aria-hidden={!infoOpen} inert={!infoOpen}>
      <button className="panel-close" aria-label={t('common.close')} onClick={() => setInfoOpen(false)}>
        ×
      </button>
      <div className="panel-no">{eyebrow}</div>
      <h2 className="panel-title">{title}</h2>
      {exhibitor && <div className="panel-artist">{exhibitor}</div>}
      {/* 上部（タイトル・作家名の直下）に置く（ユーザー指摘 2026-08-12: 「SNS情報は
          タイトルなどの直下に」— 以前は本文の下、パネルの最後尾にあった）。 */}
      <SnsLinks sns={sns} className="panel-sns" />
      {statement && <p className="panel-desc">{statement}</p>}
      {artistBio && (
        <>
          <div className="panel-frame-label" style={{ marginTop: '1.3rem' }}>
            {t('artwork.aboutArtist')}
          </div>
          <p className="panel-desc">{artistBio}</p>
        </>
      )}
    </aside>
  )
}
