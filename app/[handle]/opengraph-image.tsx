// OGP card for /@username — the exhibition card when a single public gallery
// makes this URL the room itself, otherwise a profile card
import { ImageResponse } from 'next/og'
import { fetchPublicProfile, fetchPublicExhibition } from '@/lib/publish'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'HAKONIWA — a walkable 3D exhibition'

export default async function OgImage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const username = decodeURIComponent(handle).replace(/^@/, '')
  const p = await fetchPublicProfile(username)

  let title = 'A walkable 3D exhibition'
  let sub = ''
  let note = 'Your work, given space.'
  let cover: string | undefined

  if (p && p.galleries.length === 1) {
    const ex = await fetchPublicExhibition(username, p.galleries[0].slug)
    if (ex) {
      const first = ex.artworks.find((a) => a.id === ex.coverArtworkId) ?? ex.artworks[0]
      cover = first ? (first.kind === 'video' ? first.poster : first.src) : undefined
      title = ex.title
      sub = `by ${ex.ownerName}`
      note = `Walk through ${ex.artworks.length} work${ex.artworks.length === 1 ? '' : 's'} in your browser →`
    }
  } else if (p) {
    cover = p.galleries.find((g) => g.cover)?.cover ?? undefined
    title = p.displayName
    sub = `@${p.username}`
    note = 'Walkable 3D galleries →'
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#0b0a09',
          color: '#ece7de',
          fontFamily: 'serif',
        }}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            width={560}
            height={630}
            style={{ objectFit: 'cover', borderRight: '1px solid rgba(212,162,78,0.35)' }}
          />
        ) : (
          <div
            style={{
              width: 560,
              height: 630,
              display: 'flex',
              background: 'linear-gradient(160deg, #1c1813, #0b0a09)',
            }}
          />
        )}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 64px',
          }}
        >
          <div style={{ display: 'flex', fontSize: 24, letterSpacing: 12, color: '#d4a24e' }}>
            HAKONIWA
          </div>
          <div style={{ display: 'flex', fontSize: title.length > 18 ? 44 : 58, lineHeight: 1.2, marginTop: 28 }}>
            {title}
          </div>
          {sub && (
            <div style={{ display: 'flex', fontSize: 30, color: '#9a938a', marginTop: 20 }}>{sub}</div>
          )}
          <div style={{ display: 'flex', fontSize: 22, color: '#9a938a', marginTop: 44 }}>{note}</div>
        </div>
      </div>
    ),
    size
  )
}
