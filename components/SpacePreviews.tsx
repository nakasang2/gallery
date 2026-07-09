'use client'
// Visual previews for themes / layouts / templates.
// Selection should be SEEN, not read: everything here is generated from the
// preset data itself (lib/presets.ts), so new themes/layouts preview for free.
import {
  THEMES,
  LAYOUTS,
  TEMPLATES,
  FRAMES,
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

/** A tiny "room" swatch: wall, accent wall, wood floor and the spotlight tone */
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
    </span>
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

/** A template as a picture: theme swatch backdrop + floor plan + composition line */
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
      <ThemeSwatch themeKey={t.theme} className="tpl-swatch" />
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
