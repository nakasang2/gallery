'use client'
// Visual previews for themes / layouts / templates.
// Selection should be SEEN, not read: everything here is generated from the
// preset data itself (lib/presets.ts), so new themes/layouts preview for free.
import {
  THEMES,
  LAYOUTS,
  TEMPLATES,
  FRAMES,
  HANGINGS,
  CAPTIONS,
  resolveLayout,
  type CustomLayoutParams,
} from '@/lib/presets'
import { effectiveSlotCount } from '@/lib/limits'

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

// Multiply blend (theme floorTint over the wood base, like the real floor material)
function mul(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255
  const bl = ((a & 255) * (b & 255)) / 255
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)
}

// A consistent "artwork" stand-in for framing previews (reads as art, stays neutral)
const ART_GRADIENT =
  'linear-gradient(135deg, #dcbd8e 0%, #b0764e 36%, #64503c 62%, #2b3947 82%, #18222c 100%)'

/** How a work actually looks in a given frame: bar, mat and canvas straight from FRAMES.
 *  Sized in em so the same component scales from chip to card via CSS font-size.
 *  Pass `src` (+ `ratio`) to frame a REAL artwork instead of the placeholder. */
export function FramedArt({
  frameKey,
  src,
  ratio,
  className = '',
}: {
  frameKey: string
  src?: string
  ratio?: [number, number]
  className?: string
}) {
  const f = FRAMES[frameKey] ?? FRAMES.black
  // Real artworks keep their aspect: fixed 3.6em width, height clamped for sanity
  const h = ratio ? Math.min(5.4, Math.max(2, (3.6 * ratio[1]) / ratio[0])) : 2.7
  const imgStyle: React.CSSProperties = src
    ? {
        backgroundImage: `url(${src})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        height: `${h.toFixed(2)}em`,
      }
    : { background: ART_GRADIENT, height: `${h.toFixed(2)}em` }
  if (f.mat === null) {
    // Stretched canvas: no frame, just the work with a dark edge
    return (
      <span className={`framed-art frameless ${className}`} aria-hidden="true">
        <span className="framed-art-img" style={imgStyle} />
      </span>
    )
  }
  // bar/gap are metres on a ~1.3m-wide work → scale into em against the 3.6em art
  const bar = (f.bar! / 1.3) * 3.6
  const gap = (f.gap! / 1.3) * 3.6
  return (
    <span
      className={`framed-art ${className}`}
      aria-hidden="true"
      style={{ background: hex(f.color!), padding: `${bar.toFixed(2)}em` }}
    >
      <span className="framed-art-mat" style={{ background: hex(f.mat), padding: `${gap.toFixed(2)}em` }}>
        <span className="framed-art-img" style={imgStyle} />
      </span>
    </span>
  )
}

/** A tiny "room" swatch: wall, accent wall, wood floor, the spotlight tone — and a
 *  work hanging in the theme's RECOMMENDED frame, so picking a theme shows the art */
export function ThemeSwatch({ themeKey, className = '' }: { themeKey: string; className?: string }) {
  const t = THEMES[themeKey] ?? THEMES.chic
  const floor = mul(t.floorTint, 0x9a7a55)
  return (
    <span
      className={`theme-swatch ${className}`}
      aria-hidden="true"
      style={{
        background: `linear-gradient(180deg, ${hex(t.wall)} 0%, ${hex(t.wall)} 64%, ${hex(floor)} 64%)`,
      }}
    >
      <span
        className="theme-swatch-spot"
        style={{ background: `radial-gradient(ellipse 60% 55% at 50% 0%, ${hex(t.spotColor)}59, transparent 72%)` }}
      />
      <span className="theme-swatch-accent" style={{ background: hex(t.accentWall) }} />
      <span className="theme-swatch-art">
        <FramedArt frameKey={t.recommends.frame} />
      </span>
    </span>
  )
}

/** A wide wall preview: the theme's wall + floor with a work hanging in the given
 *  frame, wires/ledge per the hanging style, and the caption plate in place.
 *  This is the dashboard's answer to "how will my art actually look?" */
export function WallPreview({
  themeKey,
  frameKey,
  hangingKey,
  captionKey,
  artSrc,
  artRatio,
  className = '',
}: {
  themeKey: string
  frameKey: string
  hangingKey: string
  captionKey: string
  /** A real uploaded work to hang instead of the placeholder gradient */
  artSrc?: string
  artRatio?: [number, number]
  className?: string
}) {
  const t = THEMES[themeKey] ?? THEMES.chic
  const floor = mul(t.floorTint, 0x9a7a55)
  const hanging = HANGINGS[hangingKey]?.kind ?? 'wire'
  const caption = CAPTIONS[captionKey]?.place ?? 'side'
  // Mirror FramedArt's sizing so the ledge and caption plate track the REAL art's
  // edges (a tall portrait must not swallow its own caption)
  const f = FRAMES[frameKey] ?? FRAMES.black
  const artH = artRatio ? Math.min(5.4, Math.max(2, (3.6 * artRatio[1]) / artRatio[0])) : 2.7
  const pad = f.mat === null ? 0.06 : ((f.bar! + f.gap!) / 1.3) * 3.6
  const halfW = 1.8 + pad
  const halfH = artH / 2 + pad
  return (
    <div
      className={`wall-preview ${className}`}
      aria-hidden="true"
      style={{
        background: `linear-gradient(180deg, ${hex(t.wall)} 0%, ${hex(t.wall)} 78%, ${hex(floor)} 78%)`,
      }}
    >
      <span
        className="wp-spot"
        style={{ background: `radial-gradient(ellipse 46% 70% at 50% 0%, ${hex(t.spotColor)}54, transparent 74%)` }}
      />
      {hanging === 'wire' && (
        <>
          <span className="wp-wire" style={{ left: 'calc(50% - 1.15em)' }} />
          <span className="wp-wire" style={{ left: 'calc(50% + 1.15em)' }} />
        </>
      )}
      <span className="wp-art">
        <FramedArt frameKey={frameKey} src={artSrc} ratio={artRatio} />
      </span>
      {hanging === 'ledge' && <span className="wp-ledge" style={{ top: `calc(46% + ${(halfH + 0.28).toFixed(2)}em)` }} />}
      {caption === 'side' && (
        <span className="wp-plate" style={{ left: `calc(50% + ${(halfW + 1.0).toFixed(2)}em)`, top: 'calc(46% + 0.7em)' }} />
      )}
      {caption === 'under' && (
        <span className="wp-plate" style={{ left: 'calc(50% - 0.85em)', top: `calc(46% + ${(halfH + 1.0).toFixed(2)}em)` }} />
      )}
    </div>
  )
}

/** Hanging style at a glance: rail wires / flush / shelf ledge */
export function HangingIcon({ hangingKey, className = '' }: { hangingKey: string; className?: string }) {
  const kind = HANGINGS[hangingKey]?.kind ?? 'wire'
  return (
    <svg viewBox="0 0 24 20" className={`hang-icon ${className}`} aria-hidden="true">
      {kind === 'wire' && (
        <>
          <line x1="9" y1="1" x2="9" y2="7" />
          <line x1="15" y1="1" x2="15" y2="7" />
        </>
      )}
      <rect x="6" y="7" width="12" height="9" rx="0.8" />
      {kind === 'ledge' && <line x1="4" y1="18" x2="20" y2="18" />}
    </svg>
  )
}

/** Caption placement at a glance: plate beside / below / none */
export function CaptionIcon({ captionKey, className = '' }: { captionKey: string; className?: string }) {
  const place = CAPTIONS[captionKey]?.place ?? 'side'
  return (
    <svg viewBox="0 0 24 20" className={`hang-icon ${className}`} aria-hidden="true">
      <rect x="4" y="3" width="11" height="9" rx="0.8" />
      {place === 'side' && <rect x="17" y="8.5" width="5" height="3.2" rx="0.5" className="cap-plate" />}
      {place === 'under' && <rect x="7" y="14.5" width="5" height="3.2" rx="0.5" className="cap-plate" />}
    </svg>
  )
}

/** Top-down floor plan generated from the actual layout definition:
 *  room outline, usable hanging slots (plan-capped), centre walls, benches, entry */
export function LayoutPlan({
  layoutKey,
  params,
  className = '',
}: {
  layoutKey: string
  params?: Partial<CustomLayoutParams> | null
  className?: string
}) {
  const def = resolveLayout(layoutKey, params)
  const slots = def.slots.slice(0, effectiveSlotCount(def.slots.length))
  const pad = 1.6
  return (
    <svg
      className={`layout-plan ${className}`}
      viewBox={`${-def.hw - pad} ${-def.hd - pad} ${def.hw * 2 + pad * 2} ${def.hd * 2 + pad * 2}`}
      aria-hidden="true"
    >
      <rect className="lp-room" x={-def.hw} y={-def.hd} width={def.hw * 2} height={def.hd * 2} rx={0.6} />
      {def.partitions.map((p, i) => (
        <rect key={`p${i}`} className="lp-part" x={p.x - p.w / 2} y={p.z - p.t / 2} width={p.w} height={Math.max(p.t, 0.6)} />
      ))}
      {def.benches.map((b, i) => (
        <rect key={`b${i}`} className="lp-bench" x={b.x - 1.05} y={b.z - 0.28} width={2.1} height={0.56} rx={0.2} />
      ))}
      {slots.map((s, i) => (
        <circle key={`s${i}`} className="lp-slot" cx={s.x} cy={s.z} r={0.55} />
      ))}
      <circle className="lp-entry" cx={def.entry.x} cy={def.entry.z} r={0.62} />
    </svg>
  )
}

/** A template as a picture: ONE preview — the wall (theme + framed art + hanging +
 *  caption) with the floor plan chipped into the corner — plus a composition line */
export function TemplateCard({
  templateId,
  active,
  onClick,
}: {
  templateId: string
  active: boolean
  onClick: () => void
}) {
  const t = TEMPLATES[templateId]
  if (!t) return null
  return (
    <button type="button" className={`tpl-card${active ? ' active' : ''}`} onClick={onClick}>
      <WallPreview
        themeKey={t.theme}
        frameKey={t.frame}
        hangingKey={t.hanging}
        captionKey={t.caption}
        className="tpl-wall"
      />
      <span className="tpl-plan-chip">
        <LayoutPlan layoutKey={t.layout} className="tpl-plan" />
      </span>
      <span className="tpl-name">{t.label}</span>
      <span className="tpl-sub">
        {THEMES[t.theme]?.label} · {LAYOUTS[t.layout]?.label} · {FRAMES[t.frame]?.label} frame
      </span>
    </button>
  )
}
