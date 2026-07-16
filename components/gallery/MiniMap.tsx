'use client'
// Always-on minimap: where am I, which way am I facing, which walls hold works.
// Geometry comes from the live layout; the camera marker updates via rAF (no re-renders).
import { useEffect, useMemo, useRef } from 'react'
import { useGallery, useSettings } from '@/lib/store'
import { usePlacement } from '@/lib/exhibition'
import { resolveLayout } from '@/lib/presets'
import { camPose } from '@/lib/controller'

export default function MiniMap() {
  const settings = useSettings()
  const { slots } = usePlacement()
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const markerRef = useRef<SVGGElement>(null)

  const def = useMemo(
    () => resolveLayout(settings.layout, settings.layoutParams),
    [settings.layout, settings.layoutParams]
  )

  // Which physical slots hold a work, and which one is focused. `focusedIndex` is a
  // position in the work list, so map it through `slots` to the physical slot (§11.13).
  const filled = useMemo(() => new Set(slots), [slots])
  const focusSlot = focusedIndex >= 0 ? slots[focusedIndex] ?? -1 : -1

  useEffect(() => {
    let raf = 0
    const tick = () => {
      markerRef.current?.setAttribute(
        'transform',
        `translate(${camPose.x} ${camPose.z}) rotate(${(-camPose.yaw * 180) / Math.PI})`
      )
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const pad = 1.6
  const w = def.hw * 2 + pad * 2
  const h = def.hd * 2 + pad * 2

  return (
    <div
      className={`minimap${focusSlot >= 0 ? ' lifted' : ''}`}
      style={{ aspectRatio: `${w} / ${h}` }}
      aria-hidden="true"
    >
      <svg className="layout-plan" viewBox={`${-def.hw - pad} ${-def.hd - pad} ${w} ${h}`}>
        <rect className="lp-room" x={-def.hw} y={-def.hd} width={def.hw * 2} height={def.hd * 2} rx={0.6} />
        {def.partitions.map((p, i) => (
          <rect
            key={`p${i}`}
            className="lp-part"
            x={p.x - p.w / 2}
            y={p.z - p.t / 2}
            width={p.w}
            height={Math.max(p.t, 0.6)}
          />
        ))}
        {def.benches.map((b, i) => (
          <rect key={`b${i}`} className="lp-bench" x={b.x - 1.05} y={b.z - 0.28} width={2.1} height={0.56} rx={0.2} />
        ))}
        {def.slots.map((s, i) => (
          <circle
            key={`s${i}`}
            className={filled.has(i) ? (i === focusSlot ? 'mm-slot focus' : 'lp-slot') : 'mm-slot empty'}
            cx={s.x}
            cy={s.z}
            r={i === focusSlot ? 0.75 : 0.55}
          />
        ))}
        {/* You: a small heading wedge */}
        <g ref={markerRef}>
          <path className="mm-you" d="M 0 -1.1 L 0.75 0.75 L 0 0.3 L -0.75 0.75 Z" />
        </g>
      </svg>
    </div>
  )
}
