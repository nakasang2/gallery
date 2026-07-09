// OGP card for a public exhibition: cover work + title + artist (ARCHITECTURE step 3 follow-up)
import { ImageResponse } from 'next/og'
import { fetchPublicExhibition } from '@/lib/publish'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'HAKONIWA — a walkable 3D exhibition'

export default async function OgImage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle, slug } = await params
  const username = decodeURIComponent(handle).replace(/^@/, '')
  const ex = await fetchPublicExhibition(username, slug)
  const first = ex?.artworks[0]
  const cover = first ? (first.kind === 'video' ? first.poster : first.src) : undefined

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
          <div
            style={{
              display: 'flex',
              fontSize: ex && ex.title.length > 18 ? 44 : 58,
              lineHeight: 1.2,
              marginTop: 28,
            }}
          >
            {ex?.title ?? 'A walkable 3D exhibition'}
          </div>
          {ex && (
            <div style={{ display: 'flex', fontSize: 30, color: '#9a938a', marginTop: 20 }}>
              by {ex.ownerName}
            </div>
          )}
          <div style={{ display: 'flex', fontSize: 22, color: '#9a938a', marginTop: 44 }}>
            {ex
              ? `Walk through ${ex.artworks.length} work${ex.artworks.length === 1 ? '' : 's'} in your browser →`
              : 'Your work, given space.'}
          </div>
        </div>
      </div>
    ),
    size
  )
}
