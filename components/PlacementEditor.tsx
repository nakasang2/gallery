'use client'
// Manual slot placement (§11.13): a tile grid of the room's slots (5 per row, up to 3
// rows = 15) with a tray of works below (ユーザー指示 2026-07-31 — the top-down room map
// became a plain grid). Two equal ways to move a work:
//   • DRAG a work (from the tray or a cell) onto a cell.
//   • TAP a work to pick it up, then tap a cell to drop it (tap it again to cancel).
// Dropping onto an occupied cell swaps the two; dragging a hung work onto the tray (or the
// "take off the wall" button) removes it. Every cell is a free target — the plan cap limits
// how many WORKS a room holds (enforced in the works stage), not which slots they take.
// Pointer Events unify mouse + touch; the draggables set touch-action:none so a press-drag
// never scrolls the page. Hit-testing is DOM-based (elementFromPoint → the cell's data-slot),
// so the grid layout is the single source of truth for where a drop lands.
import { useMemo, useRef, useState } from 'react'
import { resolveLayout } from '@/lib/presets'
import { effectiveSlotCount, MAX_WORKS_PER_ROOM } from '@/lib/limits'
import { placeWorks, balancedFillOrder } from '@/lib/arrangement'
import { VideoIcon } from '@/components/icons'
import type { ArtworkData } from '@/lib/artworks'
import type { CustomLayoutParams } from '@/lib/presets'
import { useT } from '@/components/I18nProvider'

function thumb(a: ArtworkData): string | undefined {
  return a.kind === 'video' ? a.poster : a.thumb ?? a.src
}

type Drag = { workId: string; fromSlot: number | null; x: number; y: number }
type Pending = { el: Element; pointerId: number; workId: string | null; fromSlot: number | null; x: number; y: number }
type Picked = { workId: string; fromSlot: number | null }
// How far a press may drift before it counts as a drag rather than a tap.
const TAP_SLOP = 6

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
  const t = useT()
  const def = useMemo(() => resolveLayout(layoutKey, layoutParams), [layoutKey, layoutParams])
  // How many works the room can hold — caps the number shown, not which cells are usable.
  const cap = effectiveSlotCount(def.slots.length, workCap)
  const order = useMemo(() => balancedFillOrder(def), [def])
  // Explicit placements at any physical slot are honoured up to `cap`; since works never
  // exceed cap, every hung work survives (see lib/arrangement.placeWorks). rebuildPlacements
  // uses the identical call, so the public room matches this preview.
  const perSlot = useMemo(
    () => placeWorks(def.slots.length, arrangement, works, [], order, cap),
    [def, cap, arrangement, works, order]
  )
  const current = useMemo(() => perSlot.map((a) => a?.id ?? null), [perSlot])
  const byId = useMemo(() => new Map(works.map((w) => [w.id, w] as const)), [works])
  // The cells to draw: the room's slots in walk order (balancedFillOrder), capped at the
  // ceiling, plus any occupied slot that somehow sits outside that set. Cell position (1..N)
  // is the number shown on the tile and on the tray badge.
  const shownCount = Math.min(def.slots.length, MAX_WORKS_PER_ROOM)
  const cells = useMemo(() => {
    const base = order.slice(0, shownCount)
    const set = new Set(base)
    const extra: number[] = []
    perSlot.forEach((a, i) => {
      if (a && !set.has(i)) extra.push(i)
    })
    return [...base, ...extra]
  }, [order, shownCount, perSlot])
  // workId → the cell number (1-based) it currently occupies, for the tray badge.
  const placedPos = useMemo(() => {
    const m = new Map<string, number>()
    cells.forEach((slotIdx, pos) => {
      const id = current[slotIdx]
      if (id) m.set(id, pos + 1)
    })
    return m
  }, [cells, current])

  const [drag, setDrag] = useState<Drag | null>(null)
  const [overSlot, setOverSlot] = useState<number | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const pending = useRef<Pending | null>(null)

  // The physical slot under a point, from the cell's data-slot (the drag ghost is
  // pointer-events:none, so elementFromPoint sees the cell beneath it).
  function slotAt(x: number, y: number): number | null {
    if (typeof document === 'undefined') return null
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot]')
    if (!cell) return null
    const v = cell.dataset.slot
    return v == null ? null : Number(v)
  }
  function overTray(x: number, y: number): boolean {
    if (typeof document === 'undefined') return false
    return !!document.elementFromPoint(x, y)?.closest('.place-tray')
  }

  // Hang `workId` on `target`. Onto an occupied cell swaps the two; onto an empty cell just
  // moves it. A work hangs in one place, so its old cell is vacated.
  function drop(target: number, workId: string, fromSlot: number | null) {
    const next = [...current]
    const displaced = next[target] ?? null
    if (fromSlot != null && fromSlot !== target) {
      next[fromSlot] = displaced
    } else if (fromSlot == null) {
      const p = next.indexOf(workId)
      if (p >= 0 && p !== target) next[p] = null
    }
    next[target] = workId
    if (next.some((v, i) => v !== current[i])) onChange(next)
  }
  // Take a work off the wall — it drops out of the arrangement, so it returns to the tray
  // and (because a non-empty arrangement is authoritative) is not auto-hung again.
  function removeSlot(slot: number) {
    if (current[slot] == null) return
    const next = [...current]
    next[slot] = null
    onChange(next)
    setPicked(null)
  }

  // --- drag ---
  function startDrag(el: Element, pointerId: number, workId: string, fromSlot: number | null, x: number, y: number) {
    const d = { workId, fromSlot, x, y }
    dragRef.current = d
    try { el.setPointerCapture?.(pointerId) } catch { /* not a live pointer (tests) */ }
    setDrag(d)
    setOverSlot(fromSlot)
    setPicked(null)
  }
  function moveDrag(e: React.PointerEvent) {
    if (dragRef.current) {
      const d = { ...dragRef.current, x: e.clientX, y: e.clientY }
      dragRef.current = d
      setDrag(d)
      setOverSlot(slotAt(e.clientX, e.clientY))
      return
    }
    const p = pending.current
    if (p && p.workId && (Math.abs(e.clientX - p.x) > TAP_SLOP || Math.abs(e.clientY - p.y) > TAP_SLOP)) {
      pending.current = null
      startDrag(p.el, p.pointerId, p.workId, p.fromSlot, e.clientX, e.clientY)
    }
  }
  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    const target = slotAt(e.clientX, e.clientY)
    if (target != null) drop(target, d.workId, d.fromSlot)
    else if (d.fromSlot != null && overTray(e.clientX, e.clientY)) removeSlot(d.fromSlot)
    setDrag(null)
    setOverSlot(null)
  }

  // --- press → tap or drag ---
  function press(el: Element, pointerId: number, workId: string | null, fromSlot: number | null, x: number, y: number) {
    try { el.setPointerCapture?.(pointerId) } catch { /* ignore */ }
    pending.current = { el, pointerId, workId, fromSlot, x, y }
  }
  function onUp(e: React.PointerEvent) {
    if (dragRef.current) {
      endDrag(e)
      pending.current = null
      return
    }
    const p = pending.current
    pending.current = null
    if (p) tap(p)
  }
  function tap(p: Pending) {
    const slot = slotAt(p.x, p.y)
    if (picked) {
      if (slot != null && slot !== picked.fromSlot) {
        drop(slot, picked.workId, picked.fromSlot)
        setPicked(null)
      } else if (p.workId && p.workId !== picked.workId) {
        setPicked({ workId: p.workId, fromSlot: p.fromSlot })
      } else {
        setPicked(null)
      }
      return
    }
    if (p.workId) setPicked({ workId: p.workId, fromSlot: p.fromSlot })
  }
  function cancel() {
    pending.current = null
    dragRef.current = null
    setDrag(null)
    setOverSlot(null)
  }

  // Grid-sourced press: the container hit-tests which cell was pressed.
  function onGridDown(e: React.PointerEvent) {
    if (disabled || (e.button != null && e.button > 0)) return
    const s = slotAt(e.clientX, e.clientY)
    if (s == null) return
    e.preventDefault()
    press(e.currentTarget, e.pointerId, current[s], current[s] != null ? s : null, e.clientX, e.clientY)
  }

  if (cap === 0) return null

  return (
    <div className="place-editor">
      <div
        className="place-grid"
        role="group"
        aria-label={t('design.placementMap')}
        onPointerDown={onGridDown}
        onPointerMove={moveDrag}
        onPointerUp={onUp}
        onPointerCancel={cancel}
      >
        {cells.map((slotIdx, pos) => {
          const art = perSlot[slotIdx]
          const src = art ? thumb(art) : undefined
          const isOver = slotIdx === overSlot
          const isPicked = !!picked && (picked.fromSlot === slotIdx || (!!art && picked.workId === art.id))
          return (
            <div
              key={slotIdx}
              data-slot={slotIdx}
              className={`place-cell${isOver ? ' over' : ''}${art ? ' filled' : ' empty'}${isPicked ? ' picked' : ''}${art && !disabled ? ' grab' : ''}`}
              title={
                art
                  ? t('design.spotWork', { n: pos + 1, title: art.title || t('common.untitled') })
                  : t('design.spotEmpty', { n: pos + 1 })
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src && <img crossOrigin="anonymous" src={src} alt="" loading="lazy" draggable={false} />}
              <span className="place-cell-num" aria-hidden="true">{pos + 1}</span>
            </div>
          )
        })}
      </div>

      {/* Points from the tray up into the grid — drag a work up to hang it. */}
      <div className="place-arrow" aria-hidden="true">↑</div>

      {/* The tray: every work. A hung work is dimmed and badged with the cell number it's
          on; drag one up to a cell, or tap it to pick it up. */}
      <div className="place-tray" role="list" aria-label={t('me.placementTrayLabel')}>
        {works.map((art) => {
          const src = thumb(art)
          const pos = placedPos.get(art.id)
          const isPicked = picked?.workId === art.id
          return (
            <div
              key={art.id}
              role="listitem"
              className={`place-tray-item${pos ? ' placed' : ''}${isPicked ? ' picked' : ''}${drag?.workId === art.id ? ' dragging' : ''}${disabled ? '' : ' grab'}`}
              title={art.title || t('common.untitled')}
              onPointerDown={(e) => {
                if (disabled || (e.button != null && e.button > 0)) return
                e.preventDefault()
                press(e.currentTarget, e.pointerId, art.id, null, e.clientX, e.clientY)
              }}
              onPointerMove={moveDrag}
              onPointerUp={onUp}
              onPointerCancel={cancel}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src ? (
                <img crossOrigin="anonymous" src={src} alt={art.title || ''} loading="lazy" draggable={false} />
              ) : (
                <span className="place-tray-vid" aria-hidden="true"><VideoIcon /></span>
              )}
              {pos && <span className="place-tray-num" aria-hidden="true">{pos}</span>}
            </div>
          )
        })}
      </div>

      {/* A hung work that's been picked (tapped) — offer to take it off the wall. */}
      {picked && picked.fromSlot != null && (
        <div className="place-actions">
          <span className="place-actions-label">{byId.get(picked.workId)?.title || t('common.untitled')}</span>
          <button
            type="button"
            className="btn-line"
            onClick={() => picked.fromSlot != null && removeSlot(picked.fromSlot)}
          >
            {t('me.placementRemove')}
          </button>
        </div>
      )}

      {/* The piece that follows the pointer while dragging. */}
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
