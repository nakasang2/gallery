'use client'
// Manual slot placement (§11.13): a top-down room map where the owner DRAGS a work
// from the tray onto a wall slot to hang it, and drags a hung work onto another slot
// to swap the two (ユーザー指示 2026-07-31 — the tap-and-pick picker became drag-and-
// drop). Writes back a full arrangement array so intentional gaps are stable — see
// lib/arrangement.placeWorks. Pointer Events unify mouse + touch, so the same drag
// works on a phone (the draggables set touch-action:none so a press-drag never scrolls).
import { useMemo, useRef, useState } from 'react'
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

type Drag = { workId: string; fromSlot: number | null; x: number; y: number }

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
  /** Dropping onto (or tapping) a locked spot one past this room's capacity offers the
   *  slots that would reach it — `slots` is how many more the room needs. Omit to leave
   *  locked spots inert. */
  onBuySlots?: (slots: number) => void
  disabled?: boolean
}) {
  const t = useT()
  const def = useMemo(() => resolveLayout(layoutKey, layoutParams), [layoutKey, layoutParams])
  const n = effectiveSlotCount(def.slots.length, workCap)

  // Margin around the room, in metres — just wide enough for the wall stroke plus the
  // knockout ring (every extra metre shrinks the whole map). See the geometry notes below.
  const pad = 0.5
  const w = def.hw * 2 + pad * 2
  const h = def.hd * 2 + pad * 2
  // Slot square side, in metres. 1.0 seats the square fully inside the wall (with the
  // 0.55 nudge below its outer edge lands 0.05m inside the wall line).
  const S = 1.0

  // Effective occupancy right now (auto-fill included), snapshotted as an explicit
  // per-slot id array. Writing THIS on every edit makes every shown work explicit, so
  // clearing a slot leaves a real gap instead of being back-filled by an unplaced work.
  const order = useMemo(() => balancedFillOrder(def), [def])
  const perSlot = useMemo(
    () => placeWorks(def.slots.length, arrangement, works, [], order, n),
    [def, n, arrangement, works, order]
  )
  const current = useMemo(() => perSlot.map((a) => a?.id ?? null), [perSlot])
  const byId = useMemo(() => new Map(works.map((w) => [w.id, w] as const)), [works])
  // EVERY spot the room could ever use is drawn, in walk order — the ones past capacity
  // read as locked and sell exactly the slots that would reach them. Spots past
  // MAX_WORKS_PER_ROOM stay hidden (capacity cannot be bought that far).
  const shown = useMemo(() => {
    const set = new Set(order.slice(0, Math.min(def.slots.length, MAX_WORKS_PER_ROOM)))
    perSlot.forEach((a, i) => {
      if (a) set.add(i) // an occupied spot is always shown, wherever it sits
    })
    return [...set].sort((a, b) => a - b)
  }, [order, def, perSlot])
  // Where each spot is DRAWN: nudged off its wall, along the way the work faces. 0.55
  // seats each spot 0.05m inside the wall line and clears the centre-wall pair without
  // walking a wall spot into its corner neighbour (safe band [0.37, 0.6]).
  const NUDGE = 0.55
  const at = useMemo(
    () =>
      def.slots.map((s) => ({
        x: s.x + Math.sin(s.rotY) * NUDGE,
        z: s.z + Math.cos(s.rotY) * NUDGE,
      })),
    [def]
  )
  // Capacity unlocks spots in balanced fill order, and that order's prefixes only grow.
  const unlocked = useMemo(() => new Set(order.slice(0, n)), [order, n])
  // An occupied spot is never locked: a pre-balance arrangement may pin a work outside
  // the balanced subset, and that work must stay editable.
  const isLocked = (i: number) => !unlocked.has(i) && !perSlot[i]
  const buyable = !!onBuySlots && !disabled && workCap < MAX_WORKS_PER_ROOM

  // Finger-sized hit areas, widened out to 90% of the distance to the nearest neighbour
  // (Chebyshev, so a diagonal neighbour round a corner doesn't shrink it) so a drop
  // near a slot still lands on it, and slots never steal each other's drops.
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

  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [overSlot, setOverSlot] = useState<number | null>(null)

  // A client (screen) point → the SVG's user units (metres), so a pointer anywhere over
  // the map can be resolved to the spot it's on.
  function toMap(clientX: number, clientY: number): { x: number; z: number } | null {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const p = svg.createSVGPoint()
    p.x = clientX
    p.y = clientY
    const u = p.matrixTransform(ctm.inverse())
    return { x: u.x, z: u.y } // the viewBox draws the room's z on the y axis
  }
  // The nearest shown slot whose hit square covers the point, or null.
  function slotAt(clientX: number, clientY: number): number | null {
    const u = toMap(clientX, clientY)
    if (!u) return null
    let best: number | null = null
    let bestD = Infinity
    for (const i of shown) {
      const s = at[i]
      const half = (hitSide.get(i) ?? S) / 2
      const dx = Math.abs(u.x - s.x)
      const dz = Math.abs(u.z - s.z)
      if (dx <= half && dz <= half) {
        const d = Math.max(dx, dz)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
    }
    return best
  }

  // The live drag is mirrored in a ref so the move/up handlers never read a stale
  // closure (only the ghost's position + the drop-target highlight live in state).
  const dragRef = useRef<Drag | null>(null)
  // A locked spot pressed but not dragged — a tap on it (down then up in place) buys.
  const downLocked = useRef<number | null>(null)

  function buyFor(slot: number) {
    if (!buyable) return
    const need = order.indexOf(slot) + 1 - n
    onBuySlots?.(Math.min(Math.max(1, need), MAX_WORKS_PER_ROOM - workCap))
  }
  function startDrag(el: Element, pointerId: number, workId: string, fromSlot: number | null, x: number, y: number) {
    const d = { workId, fromSlot, x, y }
    dragRef.current = d
    try { el.setPointerCapture?.(pointerId) } catch { /* not a live pointer (tests) */ }
    setDrag(d)
    setOverSlot(fromSlot)
  }
  function moveDrag(e: React.PointerEvent) {
    if (!dragRef.current) return
    const d = { ...dragRef.current, x: e.clientX, y: e.clientY }
    dragRef.current = d
    setDrag(d)
    setOverSlot(slotAt(e.clientX, e.clientY))
  }
  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    const target = slotAt(e.clientX, e.clientY)
    if (target != null) drop(target, d.workId, d.fromSlot)
    setDrag(null)
    setOverSlot(null)
  }
  function cancelDrag() {
    dragRef.current = null
    setDrag(null)
    setOverSlot(null)
  }

  // The map's slots sit under several stacked SVG rects (bg, knockout, ring), so a
  // per-slot pointerdown is unreliable — the event may land on a decoration rect that
  // isn't inside the slot's group. Instead the whole SVG hit-tests by coordinates: a
  // press on a filled spot starts dragging it, a press on a locked spot arms tap-to-buy.
  function onMapDown(e: React.PointerEvent) {
    if (disabled || (e.button != null && e.button > 0)) return
    const s = slotAt(e.clientX, e.clientY)
    downLocked.current = null
    if (s == null) return
    const id = current[s]
    if (id) {
      e.preventDefault()
      startDrag(e.currentTarget, e.pointerId, id, s, e.clientX, e.clientY)
    } else if (isLocked(s)) {
      downLocked.current = s
    }
  }
  function onMapUp(e: React.PointerEvent) {
    if (dragRef.current) {
      endDrag(e)
      return
    }
    const s = downLocked.current
    downLocked.current = null
    if (s != null && isLocked(s) && slotAt(e.clientX, e.clientY) === s) buyFor(s)
  }

  // Hang `workId` on `target`. Dropping onto an occupied slot swaps the two (so dragging
  // a work "next to" another trades places); onto an empty slot just moves it. A work
  // hangs in exactly one place, so its old slot is vacated.
  function drop(target: number, workId: string, fromSlot: number | null) {
    if (isLocked(target)) {
      if (buyable) {
        const need = order.indexOf(target) + 1 - n
        onBuySlots?.(Math.min(Math.max(1, need), MAX_WORKS_PER_ROOM - workCap))
      }
      return
    }
    const next = [...current]
    const displaced = next[target] ?? null
    if (fromSlot != null && fromSlot !== target) {
      next[fromSlot] = displaced // swap: target's old work takes the source slot (or empties it)
    } else if (fromSlot == null) {
      const p = next.indexOf(workId) // dragged from the tray — vacate wherever it currently hangs
      if (p >= 0 && p !== target) next[p] = null
    }
    next[target] = workId
    if (next.some((v, i) => v !== current[i])) onChange(next)
  }

  if (n === 0) return null

  return (
    <div className="place-editor">
      <svg
        ref={svgRef}
        className="place-map"
        viewBox={`${-def.hw - pad} ${-def.hd - pad} ${w} ${h}`}
        role="group"
        aria-label={t('design.placementMap')}
        onPointerDown={onMapDown}
        onPointerMove={moveDrag}
        onPointerUp={onMapUp}
        onPointerCancel={cancelDrag}
      >
        <rect className="lp-room" x={-def.hw} y={-def.hd} width={def.hw * 2} height={def.hd * 2} rx={0.6} />
        {def.partitions.map((p, i) => (
          <rect key={`p${i}`} className="lp-part" x={p.x - p.w / 2} y={p.z - p.t / 2} width={p.w} height={Math.max(p.t, 0.6)} />
        ))}
        {def.benches.map((b, i) => (
          <rect key={`b${i}`} className="lp-bench" x={b.x - 1.05} y={b.z - 0.28} width={2.1} height={0.56} rx={0.2} />
        ))}
        {/* Knockout layer: a ring of the surface colour just outside every spot, all
            painted BEFORE any cell, so the wall line stops short of a spot and a knockout
            never eats the neighbouring spot's outline. */}
        {shown.map((slotIdx) => {
          const s = at[slotIdx]
          const side = S + 0.16
          return (
            <rect
              key={`k${slotIdx}`}
              className="pe-slot-knockout"
              x={s.x - side / 2}
              y={s.z - side / 2}
              width={side}
              height={side}
              rx={0.22}
            />
          )
        })}
        {shown.map((slotIdx, pos) => {
          const s = at[slotIdx]
          const art = perSlot[slotIdx]
          const src = art ? thumb(art) : undefined
          const locked = isLocked(slotIdx)
          const cid = `pe-clip-${slotIdx}`
          return (
            <g
              key={`s${slotIdx}`}
              className={`pe-slot${slotIdx === overSlot ? ' over' : ''}${art ? ' filled' : ' empty'}${locked ? ' locked' : ''}${art && !disabled ? ' grab' : ''}`}
              transform={`translate(${s.x} ${s.z})`}
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
                // fill は属性でも切る: SVGの既定は黒なので、CSSが載る前でも黒い正方形が出ない。
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

      {/* The tray: every work, ready to drag onto a wall. Works already hung are dimmed
          with a dot so you can see at a glance what's still to place. */}
      <div className="place-tray" role="list" aria-label={t('me.placementTrayLabel')}>
        {works.map((art) => {
          const src = thumb(art)
          const placed = current.includes(art.id)
          return (
            <div
              key={art.id}
              role="listitem"
              className={`place-tray-item${placed ? ' placed' : ''}${drag?.workId === art.id ? ' dragging' : ''}${disabled ? '' : ' grab'}`}
              title={art.title || t('common.untitled')}
              onPointerDown={(e) => {
                if (disabled || (e.button != null && e.button > 0)) return
                e.preventDefault()
                startDrag(e.currentTarget, e.pointerId, art.id, null, e.clientX, e.clientY)
              }}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src ? (
                <img crossOrigin="anonymous" src={src} alt={art.title || ''} loading="lazy" draggable={false} />
              ) : (
                <span className="place-tray-vid" aria-hidden="true"><VideoIcon /></span>
              )}
              {placed && <span className="place-tray-dot" aria-hidden="true" />}
            </div>
          )
        })}
      </div>

      {/* The floating piece that follows the pointer while dragging. */}
      {drag && (() => {
        const art = byId.get(drag.workId)
        const src = art ? thumb(art) : undefined
        return (
          <div className="place-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src ? <img src={src} alt="" draggable={false} /> : <span className="place-tray-vid"><VideoIcon /></span>}
          </div>
        )
      })()}
    </div>
  )
}
