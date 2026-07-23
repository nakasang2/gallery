'use client'
// Manual slot placement (§11.13): a top-down room map where the owner taps a wall
// slot and assigns which work hangs there (or leaves it empty). Writes back a full
// arrangement array so intentional gaps are stable — see lib/arrangement.placeWorks.
import { useMemo, useState } from 'react'
import { resolveLayout } from '@/lib/presets'
import { effectiveSlotCount } from '@/lib/limits'
import { placeWorks, balancedFillOrder } from '@/lib/arrangement'
import { VideoIcon } from '@/components/icons'
import type { ArtworkData } from '@/lib/artworks'
import type { CustomLayoutParams } from '@/lib/presets'

function thumb(a: ArtworkData): string | undefined {
  return a.kind === 'video' ? a.poster : a.poster ?? a.src
}

export default function PlacementEditor({
  layoutKey,
  layoutParams,
  workCap,
  works,
  arrangement,
  onChange,
  disabled,
}: {
  layoutKey: string
  layoutParams: CustomLayoutParams
  workCap: number
  works: ArtworkData[]
  arrangement: (string | null)[]
  onChange: (next: (string | null)[]) => void
  disabled?: boolean
}) {
  const def = useMemo(() => resolveLayout(layoutKey, layoutParams), [layoutKey, layoutParams])
  const n = effectiveSlotCount(def.slots.length, workCap)
  const [sel, setSel] = useState<number | null>(null)

  // Effective occupancy right now (auto-fill included), snapshotted as an explicit
  // per-slot id array. Writing THIS on every edit makes every shown work explicit, so
  // clearing a slot leaves a real gap instead of being back-filled by an unplaced work.
  // Full physical slot array + capacity cap, matching the live scene's placement.
  const perSlot = useMemo(
    () => placeWorks(def.slots.length, arrangement, works, [], balancedFillOrder(def), n),
    [def, n, arrangement, works]
  )
  const current = useMemo(() => perSlot.map((a) => a?.id ?? null), [perSlot])
  const byId = useMemo(() => new Map(works.map((w) => [w.id, w] as const)), [works])
  // Spots shown on the map: the balanced usable subset, plus any slot an existing
  // arrangement already occupies (pre-balance rooms pinned works on slots 0..n-1) —
  // sorted so numbering follows the walk order.
  const usable = useMemo(() => {
    // Occupied slots are ALWAYS shown (a pre-balance arrangement may pin works
    // outside the balanced subset); only empty spots are limited to the subset.
    const set = new Set(balancedFillOrder(def).slice(0, n))
    perSlot.forEach((a, i) => {
      if (a) set.add(i)
    })
    return [...set].sort((a, b) => a - b)
  }, [def, n, perSlot])

  const pad = 1.6
  const w = def.hw * 2 + pad * 2
  const h = def.hd * 2 + pad * 2
  const S = 1.25 // slot square side, in metres

  function assign(slot: number, workId: string) {
    const next = [...current]
    const prev = next.indexOf(workId)
    if (prev >= 0 && prev !== slot) next[prev] = null // a work hangs in one place only
    next[slot] = workId
    onChange(next)
  }
  function clear(slot: number) {
    const next = [...current]
    next[slot] = null
    onChange(next)
  }

  if (n === 0) return null
  const selWork = sel != null ? byId.get(current[sel] ?? '') ?? null : null

  return (
    <div className="place-editor">
      <svg className="place-map" viewBox={`${-def.hw - pad} ${-def.hd - pad} ${w} ${h}`} role="group" aria-label="Room placement map">
        <rect className="lp-room" x={-def.hw} y={-def.hd} width={def.hw * 2} height={def.hd * 2} rx={0.6} />
        {def.partitions.map((p, i) => (
          <rect key={`p${i}`} className="lp-part" x={p.x - p.w / 2} y={p.z - p.t / 2} width={p.w} height={Math.max(p.t, 0.6)} />
        ))}
        {def.benches.map((b, i) => (
          <rect key={`b${i}`} className="lp-bench" x={b.x - 1.05} y={b.z - 0.28} width={2.1} height={0.56} rx={0.2} />
        ))}
        {usable.map((slotIdx, order) => {
          const s = def.slots[slotIdx]
          const art = perSlot[slotIdx]
          const src = art ? thumb(art) : undefined
          const cid = `pe-clip-${slotIdx}`
          return (
            <g
              key={`s${slotIdx}`}
              className={`pe-slot${slotIdx === sel ? ' sel' : ''}${art ? ' filled' : ' empty'}`}
              transform={`translate(${s.x} ${s.z})`}
              onClick={() => !disabled && setSel(slotIdx)}
              style={{ cursor: disabled ? 'default' : 'pointer' }}
            >
              <clipPath id={cid}>
                <rect x={-S / 2} y={-S / 2} width={S} height={S} rx={0.16} />
              </clipPath>
              <rect className="pe-slot-bg" x={-S / 2} y={-S / 2} width={S} height={S} rx={0.16} />
              {src && (
                <image
                  href={src}
                  x={-S / 2}
                  y={-S / 2}
                  width={S}
                  height={S}
                  clipPath={`url(#${cid})`}
                  preserveAspectRatio="xMidYMid slice"
                />
              )}
              <rect className="pe-slot-ring" x={-S / 2} y={-S / 2} width={S} height={S} rx={0.16} />
              {!art && <text className="pe-slot-num" x={0} y={0.12}>{order + 1}</text>}
            </g>
          )
        })}
      </svg>

      {/* Guidance lives in the Placement heading's ⓘ tooltip now — no inline hint here */}
      {sel == null ? null : (
        <div className="place-picker">
          <div className="place-picker-head">
            <span>Spot {usable.indexOf(sel) >= 0 ? usable.indexOf(sel) + 1 : '–'}{selWork ? ` — ${selWork.title || 'Untitled'}` : ' — empty'}</span>
            <button className="btn-line" onClick={() => setSel(null)}>Done</button>
          </div>
          <div className="place-picker-strip">
            <button
              className={`place-pick empty${!selWork ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => clear(sel)}
              title="Leave this spot empty"
            >
              <span aria-hidden="true">∅</span>
              <small>Empty</small>
            </button>
            {works.map((art) => {
              const src = thumb(art)
              const here = current[sel] === art.id
              const elsewhere = current.includes(art.id) && !here
              return (
                <button
                  key={art.id}
                  className={`place-pick${here ? ' active' : ''}`}
                  disabled={disabled}
                  onClick={() => assign(sel, art.id)}
                  title={elsewhere ? `${art.title || 'Untitled'} — currently in another spot` : art.title || 'Untitled'}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {src ? (
                    <img src={src} alt={art.title} loading="lazy" />
                  ) : (
                    <span style={{ fontSize: '1.4rem', color: 'var(--muted)' }}>
                      <VideoIcon />
                    </span>
                  )}
                  {elsewhere && <span className="place-pick-badge" aria-hidden="true">↔</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
