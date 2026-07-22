'use client'
// Exhibition-info panel — the "detail UI" for the title wall (opened by clicking it),
// the board's counterpart to the per-work ArtworkPanel. Reuses the .panel drawer.
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle } from '@/lib/publish'
import { DEFAULT_TITLE_TEXT } from './textures'

export default function InfoPanel() {
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

  if (visitor) {
    title = isPlaceholderTitle(visitor.title) ? visitor.ownerName : visitor.title
    exhibitor = visitor.ownerName
    statement = visitor.statement
    artistBio = visitor.ownerBio
  } else if (user && myGallery) {
    title = isPlaceholderTitle(myGallery.title) ? displayName || 'Your exhibition' : myGallery.title
    exhibitor = displayName || ''
    statement = myGallery.statement
    artistBio = bio ?? ''
  }

  return (
    <aside id="info-panel" className={`panel${infoOpen ? ' open' : ''}`} aria-hidden={!infoOpen} inert={!infoOpen}>
      <button className="panel-close" aria-label="Close" onClick={() => setInfoOpen(false)}>
        ×
      </button>
      <div className="panel-no">{eyebrow}</div>
      <h2 className="panel-title">{title}</h2>
      {exhibitor && <div className="panel-artist">{exhibitor}</div>}
      {statement && <p className="panel-desc">{statement}</p>}
      {artistBio && (
        <>
          <div className="panel-frame-label" style={{ marginTop: '1.3rem' }}>
            About the artist
          </div>
          <p className="panel-desc">{artistBio}</p>
        </>
      )}
    </aside>
  )
}
