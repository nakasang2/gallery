// Shared OGP card body — used by every opengraph-image.tsx in the app
// (`/@handle`, `/@handle/[slug]`, `/expo/[slug]`, `/expo/[slug]/[room]`). Kept in
// one place so the layout/styling, the Japanese-font fix, and the relative-URL
// guard (リリース前監査 #16) don't drift between the routes that render this card
// — `app/[handle]/opengraph-image.tsx` used to hand-duplicate all of this
// (別視点レビューで発見・2026-08-21), which is exactly the drift this file exists
// to prevent.
import { ImageResponse } from 'next/og'
import { isPlaceholderTitle, type PublicExhibition } from '@/lib/publish'
import { absoluteMedia } from '@/lib/seo'
import { zenOldMinchoFont, OG_FONT_FAMILY, OG_FONT_FALLBACK_FAMILY } from '@/lib/ogFont'

export const OG_IMAGE_SIZE = { width: 1200, height: 630 }

export interface OgCardContent {
  /** Must already be an absolute http(s) URL — callers guard this themselves
   *  (usually via `absoluteMedia`), since what counts as "the cover" differs by
   *  page (an exhibition's featured work vs. a profile's chosen gallery cover). */
  cover?: string
  heading: string
  sub?: string
  note: string
}

/** The one place that actually builds the image — every opengraph-image.tsx
 *  route ends up here, directly or via `exhibitionOgImage` below. */
export async function renderOgCard({ cover, heading, sub, note }: OgCardContent): Promise<ImageResponse> {
  // `null` means the font file couldn't be read — render with the generic serif
  // rather than let the whole card fail (lib/ogFont.ts).
  const fontData = await zenOldMinchoFont()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#0b0a09',
          color: '#ece7de',
          fontFamily: fontData ? `'${OG_FONT_FAMILY}'` : OG_FONT_FALLBACK_FAMILY,
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
            XIBIT360
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: heading.length > 18 ? 44 : 58,
              lineHeight: 1.2,
              marginTop: 28,
            }}
          >
            {heading}
          </div>
          {sub && (
            <div style={{ display: 'flex', fontSize: 30, color: '#9a938a', marginTop: 20 }}>{sub}</div>
          )}
          <div style={{ display: 'flex', fontSize: 22, color: '#9a938a', marginTop: 44 }}>{note}</div>
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE, fonts: fontData ? [{ name: OG_FONT_FAMILY, data: fontData, style: 'normal', weight: 400 }] : undefined }
  )
}

/** Convenience wrapper for the common case — a page IS a single `PublicExhibition`
 *  (or nothing, when the slug/handle didn't resolve). Used by `/@handle/[slug]`
 *  and both `/expo/[slug]` routes; `/@handle` has its own profile-vs-exhibition
 *  branching and calls `renderOgCard` directly. */
export async function exhibitionOgImage(ex: PublicExhibition | null): Promise<ImageResponse> {
  const first = ex ? ex.artworks.find((a) => a.id === ex.coverArtworkId) ?? ex.artworks[0] : undefined
  // `absoluteMedia` refuses a relative path instead of handing it to ImageResponse,
  // which throws on one and takes the whole card down (リリース前監査 #16).
  const cover = first ? absoluteMedia(first.kind === 'video' ? first.poster : first.src) : undefined
  const heading = ex ? (isPlaceholderTitle(ex.title) ? ex.ownerName : ex.title) : 'A walkable 3D exhibition'
  const sub = ex ? (isPlaceholderTitle(ex.title) ? `@${ex.username}` : `by ${ex.ownerName}`) : undefined
  const note = ex
    ? `Walk through ${ex.artworks.length} work${ex.artworks.length === 1 ? '' : 's'} in your browser →`
    : 'Your work, given space.'
  return renderOgCard({ cover, heading, sub, note })
}
