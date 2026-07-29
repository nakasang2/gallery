'use client'
// Manual slot placement (§11.13): a top-down room map where the owner taps a wall
// slot and assigns which work hangs there (or leaves it empty). Writes back a full
// arrangement array so intentional gaps are stable — see lib/arrangement.placeWorks.
import { useMemo, useState } from 'react'
import { resolveLayout } from '@/lib/presets'
import { effectiveSlotCount, MAX_WORKS_PER_ROOM } from '@/lib/limits'
import { placeWorks, balancedFillOrder } from '@/lib/arrangement'
import { VideoIcon } from '@/components/icons'
import type { ArtworkData } from '@/lib/artworks'
import type { CustomLayoutParams } from '@/lib/presets'
import { useT } from '@/components/I18nProvider'

function thumb(a: ArtworkData): string | undefined {
  // 56px tiles — the 400px thumb is plenty and always exists
  return a.kind === 'video' ? a.poster : a.thumb ?? a.src
}

export default function PlacementEditor({
  layoutKey,
  layoutParams,
  workCap,
  works,
  arrangement,
  onChange,
  onBuySlots,
  disabled,
}: {
  layoutKey: string
  layoutParams: CustomLayoutParams
  workCap: number
  works: ArtworkData[]
  arrangement: (string | null)[]
  onChange: (next: (string | null)[]) => void
  /** Tapping a locked spot (one past this room's capacity) offers the slots that
   *  would reach it — `slots` is how many more the room needs, so the purchase
   *  actually unlocks the spot that was tapped, not some other one. Omit to
   *  leave locked spots inert. */
  onBuySlots?: (slots: number) => void
  disabled?: boolean
}) {
  const t = useT()
  const def = useMemo(() => resolveLayout(layoutKey, layoutParams), [layoutKey, layoutParams])
  const n = effectiveSlotCount(def.slots.length, workCap)
  const [sel, setSel] = useState<number | null>(null)

  const pad = 1.6
  const w = def.hw * 2 + pad * 2
  const h = def.hd * 2 + pad * 2
  const S = 1.25 // slot square side, in metres

  // Effective occupancy right now (auto-fill included), snapshotted as an explicit
  // per-slot id array. Writing THIS on every edit makes every shown work explicit, so
  // clearing a slot leaves a real gap instead of being back-filled by an unplaced work.
  // Full physical slot array + capacity cap, matching the live scene's placement.
  const order = useMemo(() => balancedFillOrder(def), [def])
  const perSlot = useMemo(
    () => placeWorks(def.slots.length, arrangement, works, [], order, n),
    [def, n, arrangement, works, order]
  )
  const current = useMemo(() => perSlot.map((a) => a?.id ?? null), [perSlot])
  const byId = useMemo(() => new Map(works.map((w) => [w.id, w] as const)), [works])
  // EVERY spot the room could ever use is drawn, in walk order — not just the ones
  // it has capacity for today (ユーザー指摘 2026-07-29). Showing five of fifteen hid
  // the fact that the room can grow at all; the rest now read as locked and sell
  // exactly the slots that would reach them. Spots past MAX_WORKS_PER_ROOM stay
  // hidden: capacity cannot be bought that far, so a lock there would be a dead
  // end (only reachable at all in a custom room with a centre wall, whose slot
  // count runs one past the ceiling).
  const shown = useMemo(() => {
    const set = new Set(order.slice(0, Math.min(def.slots.length, MAX_WORKS_PER_ROOM)))
    perSlot.forEach((a, i) => {
      if (a) set.add(i) // an occupied spot is always shown, wherever it sits
    })
    return [...set].sort((a, b) => a - b)
  }, [order, def, perSlot])
  // Where each spot is DRAWN: nudged off its wall, along the way the work faces.
  // The two faces of a centre wall sit 0.52m apart, so at S=1.25 they landed on top
  // of each other — the island layout drew 13 squares for 15 spots and the buried
  // pair could not be tapped (measured 2026-07-29). NUDGE has to clear that pair
  // (needs ≥ 0.37) without walking a wall's spot into the one round the corner
  // (portrait's corner pairs sit 1.85m apart, so ≤ 0.6). Squares end up sitting on
  // the inner edge of their wall, which also reads better than straddling it.
  const NUDGE = 0.5
  const at = useMemo(
    () =>
      def.slots.map((s) => ({
        x: s.x + Math.sin(s.rotY) * NUDGE,
        z: s.z + Math.cos(s.rotY) * NUDGE,
      })),
    [def]
  )
  // Capacity unlocks spots in balanced fill order, and that order's prefixes only
  // grow — so buying a slot never takes an unlocked spot away.
  const unlocked = useMemo(() => new Set(order.slice(0, n)), [order, n])
  // An occupied spot is never locked: a pre-balance arrangement may pin a work
  // outside the balanced subset, and that work must stay editable.
  const isLocked = (i: number) => !unlocked.has(i) && !perSlot[i]
  const buyable = !!onBuySlots && !disabled && workCap < MAX_WORKS_PER_ROOM

  // Finger-sized hit areas. The map is scale-bound: a hall (26×16m) drawn into a
  // 360px-wide box renders at ~11px per metre, so the 1.25m square is ~14px — a
  // third of the 44px minimum, and no amount of extra map width fixes that
  // (measured 2026-07-28). So we widen the *hit* area instead of the drawing,
  // out to 90% of the distance to the nearest neighbour so slots can never
  // steal each other's taps. Only live on coarse pointers — see .pe-slot-hit.
  //
  // The distance is measured on the axis that separates the two spots (Chebyshev),
  // not as the crow flies: the hit areas are axis-aligned squares, so a diagonal
  // neighbour round a corner is further away than its squares are (measured with
  // hypot, 2 pairs in a hall and 4 in an island room overlapped).
  const hitSide = useMemo(() => {
    const m = new Map<number, number>()
    for (const i of shown) {
      const a = at[i]
      let nearest = Infinity
      for (const j of shown) {
        if (j === i) continue
        const b = at[j]
        nearest = Math.min(nearest, Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)))
      }
      m.set(i, Math.min(4.4, Math.max(S, nearest * 0.9)))
    }
    return m
  }, [at, shown])

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

  function tap(slotIdx: number) {
    if (disabled) return
    if (!isLocked(slotIdx)) {
      setSel(slotIdx)
      return
    }
    if (!buyable) return
    // How many slots this room still needs before the tapped spot opens up.
    const need = order.indexOf(slotIdx) + 1 - n
    onBuySlots?.(Math.min(Math.max(1, need), MAX_WORKS_PER_ROOM - workCap))
  }

  if (n === 0) return null
  // A layout change can re-shuffle which spots are unlocked, so a spot picked
  // before the change may now be locked — close the picker rather than let a
  // work be hung on a spot the room cannot use.
  const open = sel != null && !isLocked(sel) ? sel : null
  const selWork = open != null ? byId.get(current[open] ?? '') ?? null : null
  // 枠の番号は歩く順（地図に出ている枠のうちの何番目か）
  const spotNo = open != null ? shown.indexOf(open) + 1 : '–'

  return (
    <div className="place-editor">
      <svg className="place-map" viewBox={`${-def.hw - pad} ${-def.hd - pad} ${w} ${h}`} role="group" aria-label={t('design.placementMap')}>
        <rect className="lp-room" x={-def.hw} y={-def.hd} width={def.hw * 2} height={def.hd * 2} rx={0.6} />
        {def.partitions.map((p, i) => (
          <rect key={`p${i}`} className="lp-part" x={p.x - p.w / 2} y={p.z - p.t / 2} width={p.w} height={Math.max(p.t, 0.6)} />
        ))}
        {def.benches.map((b, i) => (
          <rect key={`b${i}`} className="lp-bench" x={b.x - 1.05} y={b.z - 0.28} width={2.1} height={0.56} rx={0.2} />
        ))}
        {shown.map((slotIdx, pos) => {
          const s = at[slotIdx]
          const art = perSlot[slotIdx]
          const src = art ? thumb(art) : undefined
          const locked = isLocked(slotIdx)
          const cid = `pe-clip-${slotIdx}`
          return (
            <g
              key={`s${slotIdx}`}
              className={`pe-slot${slotIdx === open ? ' sel' : ''}${art ? ' filled' : ' empty'}${locked ? ' locked' : ''}`}
              transform={`translate(${s.x} ${s.z})`}
              onClick={() => tap(slotIdx)}
              style={{ cursor: disabled || (locked && !buyable) ? 'default' : 'pointer' }}
            >
              <title>
                {locked
                  ? t('design.spotLocked', { n: pos + 1 })
                  : art
                    ? t('design.spotWork', { n: pos + 1, title: art.title || t('common.untitled') })
                    : t('design.spotEmpty', { n: pos + 1 })}
              </title>
              <clipPath id={cid}>
                <rect x={-S / 2} y={-S / 2} width={S} height={S} rx={0.16} />
              </clipPath>
              {(() => {
                const hs = hitSide.get(slotIdx) ?? S
                // fill は属性でも切る: SVGの既定は黒なので、CSSが載る前や印刷経路で
                // 4m四方の黒い正方形が出ないようにする。
                return <rect className="pe-slot-hit" fill="none" x={-hs / 2} y={-hs / 2} width={hs} height={hs} />
              })()}
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
              {/* A padlock drawn in map units (an icon font would not scale with the
                  viewBox): body + shackle, sized to sit inside the 1.25m square. */}
              {locked ? (
                <g className="pe-slot-lock" aria-hidden="true">
                  <rect x={-0.25} y={-0.02} width={0.5} height={0.38} rx={0.08} />
                  <path d="M -0.15 -0.02 V -0.17 A 0.15 0.15 0 0 1 0.15 -0.17 V -0.02" />
                </g>
              ) : (
                !art && <text className="pe-slot-num" x={0} y={0.12}>{pos + 1}</text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Guidance lives in the Placement heading's ⓘ tooltip now — no inline hint here */}
      {open == null ? null : (
        <div className="place-picker">
          <div className="place-picker-head">
            <span>
              {selWork
                ? t('design.spotWork', { n: spotNo, title: selWork.title || t('common.untitled') })
                : t('design.spotEmpty', { n: spotNo })}
            </span>
            <button className="btn-line" onClick={() => setSel(null)}>{t('design.placementDone')}</button>
          </div>
          <div className="place-picker-strip">
            <button
              className={`place-pick empty${!selWork ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => clear(open)}
              title={t('design.placementEmpty')}
            >
              <span aria-hidden="true">∅</span>
              <small>{t('design.empty')}</small>
            </button>
            {works.map((art) => {
              const src = thumb(art)
              const here = current[open] === art.id
              const elsewhere = current.includes(art.id) && !here
              return (
                <button
                  key={art.id}
                  className={`place-pick${here ? ' active' : ''}`}
                  disabled={disabled}
                  onClick={() => assign(open, art.id)}
                  title={elsewhere ? t('design.spotElsewhere', { title: art.title || t('common.untitled') }) : art.title || t('common.untitled')}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {src ? (
                    <img crossOrigin="anonymous" src={src} alt={art.title} loading="lazy" />
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
