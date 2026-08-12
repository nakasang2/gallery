'use client'
// Manual slot placement (§11.13): a top-down room map where the owner arranges works on
// the walls. Two equal ways to move a work (ユーザー指示 2026-07-31):
//   • DRAG a work (from the tray or a spot) onto a spot.
//   • TAP a work to pick it up, then tap a spot to drop it (tap the same work to cancel).
// Dropping onto an occupied spot swaps the two. Every physical spot is a free target —
// which wall a work hangs on is never locked. **This room's own `cap` still limits how
// many works it can hold**, though (ユーザー指摘 2026-08-12: 「最初の展示室では作品が
// ドラッグ&ドロップできない」— `works` is the account's whole shared pool since the
// multi-room/共通プール化 work, so it can exceed a single room's `work_cap`; the comment
// this replaced assumed the opposite and `drop()` had no cap check, so dropping a work
// the room had no room left for was silently swallowed by `placeWorks` a render later —
// `onChange` fired, arrangement grew past `cap`, and the extra entry just never got
// honoured, with no sign of why). `drop()` below refuses instead, with a toast. Pointer
// Events unify mouse + touch, and the map sets touch-action:none so a press-drag never
// scrolls the page.
import { useMemo, useRef, useState } from 'react'
import { resolveLayout } from '@/lib/presets'
import { effectiveSlotCount, MAX_WORKS_PER_ROOM } from '@/lib/limits'
import { placeWorks, balancedFillOrder } from '@/lib/arrangement'
import { VideoIcon } from '@/components/icons'
import type { ArtworkData } from '@/lib/artworks'
import type { CustomLayoutParams } from '@/lib/presets'
import { useT } from '@/components/I18nProvider'
import { showToast } from '@/lib/toast'

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
  poolTotal,
  works,
  guests = [],
  arrangement,
  onChange,
  placedElsewhere,
  disabled,
}: {
  layoutKey: string
  layoutParams: CustomLayoutParams
  // この部屋が**今**使える枠（口座全体の枠 − 他の部屋に今置かれている点数）。部屋ごと
  // 固定ではなく口座全体で自由配分する（ユーザー決定 2026-08-12）ため、他の部屋の
  // 配置が変われば同じ部屋でもこの値は変わる。
  workCap: number
  /** cap到達メッセージに出す「口座全体の枠」。省略時は`workCap`（1部屋だけの口座では
   *  同じ数）。`workCap`自体は上の理由で部屋ごとに変わる派生値なので、そのままメッセージに
   *  出すと「なぜこの部屋だけこの数なのか」が伝わらない。 */
  poolTotal?: number
  works: ArtworkData[]
  /** 合同展示で他の作家が出した作品。掛けられるが**自動では並ばない**
   *  （提出は申し出であって決定ではない — lib/arrangement.placeWorks 参照）。
   *  トレイでは作家名を出して区別する: 名前が無いと、誰の作品を掛けているのか
   *  分からないまま公開ボタンを押すことになる。 */
  guests?: ArtworkData[]
  arrangement: (string | null)[]
  onChange: (next: (string | null)[]) => void
  // 口座内の他の部屋（この部屋以外）に既に配置済みの作品idの集合（ユーザー指示 2026-08-11）。
  placedElsewhere?: ReadonlySet<string>
  disabled?: boolean // i18n-ok: TS型宣言（直前行の`<string>`をタグと誤認する検知器の誤検知）
}) {
  const t = useT()
  const def = useMemo(() => resolveLayout(layoutKey, layoutParams), [layoutKey, layoutParams])
  // How many works the room can hold — caps the number shown, not which spots are usable.
  const cap = effectiveSlotCount(def.slots.length, workCap)

  // Slot square side, in metres. Big (1.9) so the spots read as generous targets. The
  // spots sit centred ON the wall line (see `at`), so half the square (0.95) laps outside
  // the room outline — the margin has to clear that plus the hover-scale, or a wall spot
  // clips at the viewBox edge.
  const S = 1.9
  const pad = 1.35
  const w = def.hw * 2 + pad * 2
  const h = def.hd * 2 + pad * 2

  const order = useMemo(() => balancedFillOrder(def), [def])
  // Explicit placements at any physical spot are honoured up to `cap`; since works never
  // exceed cap, every hung work survives (see lib/arrangement.placeWorks). rebuildPlacements
  // uses the identical call, so the public room matches this preview.
  const perSlot = useMemo(
    () => placeWorks(def.slots.length, arrangement, works, [], order, cap, guests),
    [def, cap, arrangement, works, order, guests]
  )
  const current = useMemo(() => perSlot.map((a) => a?.id ?? null), [perSlot])
  // The tray, and every lookup below, spans both sets — dragging, swapping and taking
  // down have to work identically for a guest's work or the map goes half-dead.
  const trayWorks = useMemo(() => [...works, ...guests], [works, guests])
  const guestIds = useMemo(() => new Set(guests.map((g) => g.id)), [guests])
  const byId = useMemo(() => new Map(trayWorks.map((w) => [w.id, w] as const)), [trayWorks])
  // Every physical spot in walk order (capped at the ceiling), plus any occupied spot.
  const shownCount = Math.min(def.slots.length, MAX_WORKS_PER_ROOM)
  const shown = useMemo(() => {
    const set = new Set(order.slice(0, shownCount))
    perSlot.forEach((a, i) => {
      if (a) set.add(i)
    })
    return [...set].sort((a, b) => a - b)
  }, [order, shownCount, perSlot])
  // workId → the spot number (1-based, its position in `shown`) it occupies, for the tray badge.
  const placedPos = useMemo(() => {
    const m = new Map<string, number>()
    shown.forEach((slotIdx, pos) => {
      const id = current[slotIdx]
      if (id) m.set(id, pos + 1)
    })
    return m
  }, [shown, current])
  // Outer-wall spots sit centred ON the wall line so the room outline runs through each
  // spot's centre (ユーザー指示 2026-07-31). The centre-wall spots (a partition's two
  // faces, marked noWire) sit only 0.52m apart, so at S=1.9 they'd overlap into one smear
  // — nudge just those off the partition along the way they face so the two faces read as
  // two spots.
  const NUDGE_WALL = 0.8
  const at = useMemo(
    () =>
      def.slots.map((s) =>
        s.noWire
          ? { x: s.x + Math.sin(s.rotY) * NUDGE_WALL, z: s.z + Math.cos(s.rotY) * NUDGE_WALL }
          : { x: s.x, z: s.z }
      ),
    [def]
  )

  // Drop tolerance per spot: out to 90% of the distance to the nearest neighbour
  // (Chebyshev), so a release near a spot still lands on it and spots never steal each
  // other's drops.
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
  const [picked, setPicked] = useState<Picked | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const pending = useRef<Pending | null>(null)
  // Set right after a real drag completes, cleared on the next tick. Pointer capture
  // retargets the compatibility mouseup/click to whatever element started the press
  // (see endDrag) — without this guard, dragging a work off the ✕ button's corner fires
  // a spurious click on that same button right after the drop and removes what was just
  // placed.
  const justDraggedRef = useRef(false)

  function toMap(clientX: number, clientY: number): { x: number; z: number } | null {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const p = svg.createSVGPoint()
    p.x = clientX
    p.y = clientY
    const u = p.matrixTransform(ctm.inverse())
    return { x: u.x, z: u.y }
  }
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

  // Hang `workId` on `target`. Onto an occupied spot swaps the two; onto an empty spot
  // just moves it. A work hangs in one place, so its old spot is vacated. Only a drop
  // that actually GROWS the filled count needs the cap check — moving/swapping a work
  // already hanging here doesn't (net change zero), and neither does swapping an
  // unplaced work onto an OCCUPIED spot (whoever it displaces leaves as this one
  // arrives, so the count stays put too). The only way this room gains a work is an
  // unplaced one landing on an EMPTY spot (別視点レビュー指摘 2026-08-12: 最初の版は
  // target の空き/占有を見ておらず、満室でも「掛かっている作品を差し替える」という
  // 元から効いていた操作までブロックしていた).
  function drop(target: number, workId: string, fromSlot: number | null) {
    const grows = !current.includes(workId) && current[target] == null
    if (grows && current.filter((v) => v != null).length >= cap) {
      showToast(t('me.placementCapReached', { cap: poolTotal ?? cap }))
      return
    }
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

  // --- drag ---
  function startDrag(el: Element, pointerId: number, workId: string, fromSlot: number | null, x: number, y: number) {
    const d = { workId, fromSlot, x, y }
    dragRef.current = d
    try { el.setPointerCapture?.(pointerId) } catch { /* not a live pointer (tests) */ }
    setDrag(d)
    setOverSlot(fromSlot)
    setPicked(null) // a drag supersedes a tap-selection
  }
  function moveDrag(e: React.PointerEvent) {
    if (dragRef.current) {
      const d = { ...dragRef.current, x: e.clientX, y: e.clientY }
      dragRef.current = d
      setDrag(d)
      setOverSlot(slotAt(e.clientX, e.clientY))
      return
    }
    // Not dragging yet — a press that drifts past the slop turns into a drag.
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
    // Dragging a hung work back onto the tray takes it off the wall.
    else if (d.fromSlot != null && overTray(e.clientX, e.clientY)) removeSlot(d.fromSlot)
    setDrag(null)
    setOverSlot(null)
    justDraggedRef.current = true
    setTimeout(() => { justDraggedRef.current = false }, 0)
  }
  // True when the point is over the tray (so a drop there removes rather than places).
  // The drag ghost is pointer-events:none, so elementFromPoint sees the tray beneath it.
  function overTray(x: number, y: number): boolean {
    if (typeof document === 'undefined') return false
    const el = document.elementFromPoint(x, y)
    return !!el?.closest('.place-tray')
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
  // A press that never became a drag: place the picked work, switch pick, or pick up.
  function tap(p: Pending) {
    activate({ slot: slotAt(p.x, p.y), workId: p.workId, fromSlot: p.fromSlot })
  }
  /**
   * 「持ち上げる／置く」の判断そのもの。**座標ではなく対象を受け取る**ので、ポインタ
   * （`tap`）とキーボード（Enter / Space）の両方が同じ1つの実装を通る ── 判断を2か所に
   * 書くと、片方だけ直して食い違う（このファイルは既にその種のバグを2回踏んでいる）。
   */
  function activate(target: { slot: number | null; workId: string | null; fromSlot: number | null }) {
    if (disabled) return
    if (picked) {
      if (target.slot != null && target.slot !== picked.fromSlot) {
        drop(target.slot, picked.workId, picked.fromSlot)
        setPicked(null)
      } else if (target.workId && target.workId !== picked.workId) {
        setPicked({ workId: target.workId, fromSlot: target.fromSlot })
      } else {
        setPicked(null)
      }
      return
    }
    if (target.workId) setPicked({ workId: target.workId, fromSlot: target.fromSlot })
  }
  /**
   * キーボード操作（WCAG 2.1 2.1.1・ユーザー決定 2026-08-12）。ポインタが無いと
   * **壁から外せるのに掛けられない**状態だった（✕だけが `<button>` で、ドロップ先は
   * role も tabindex も無い `<g>`、トレイのタイルは `<div>`）。
   * 操作はタップと同じモデル: 作品を選ぶ → 枠を選ぶ → 置く。Esc で選択解除。
   * Space は既定のスクロールを止める（枠は画面下にもあるため、ページが飛ぶと現在地を失う）。
   */
  function onKeyActivate(
    e: React.KeyboardEvent,
    target: { slot: number | null; workId: string | null; fromSlot: number | null },
  ) {
    if (e.key === 'Escape') {
      if (picked) {
        e.preventDefault()
        setPicked(null)
      }
      return
    }
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
    e.preventDefault()
    activate(target)
  }
  function cancel() {
    pending.current = null
    dragRef.current = null
    setDrag(null)
    setOverSlot(null)
  }

  function onMapDown(e: React.PointerEvent) {
    if (disabled || (e.button != null && e.button > 0)) return
    const s = slotAt(e.clientX, e.clientY)
    if (s == null) return
    e.preventDefault()
    press(e.currentTarget, e.pointerId, current[s], current[s] != null ? s : null, e.clientX, e.clientY)
  }

  // Reachable now that capacity is shared across rooms rather than fixed per room
  // (ユーザー決定 2026-08-12): a room can end up with nothing left of the pool if every
  // slot is in use elsewhere. Say so — a blank editor with no explanation is the exact
  // "can't drag and drop" report this change was meant to fix, just moved to a new spot.
  if (cap === 0) return <p className="me-note">{t('me.placementCapReached', { cap: poolTotal ?? cap })}</p>

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
        onPointerUp={onUp}
        onPointerCancel={cancel}
      >
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
          const isOver = slotIdx === overSlot
          const isPicked = !!picked && (picked.fromSlot === slotIdx || (!!art && picked.workId === art.id))
          const cid = `pe-clip-${slotIdx}`
          return (
            <g
              key={`s${slotIdx}`}
              className={`pe-slot${isOver ? ' over' : ''}${art ? ' filled' : ' empty'}${isPicked ? ' picked' : ''}${art && !disabled ? ' grab' : ''}`}
              // Scale about the spot's own centre (children are drawn at 0,0) so the hover
              // target visibly pops toward the pointer.
              transform={`translate(${s.x} ${s.z})${isOver ? ' scale(1.16)' : ''}`}
              // キーボードで枠に到達できるようにする（ユーザー決定 2026-08-12）。SVGの
              // `<g>` は既定でフォーカスも役割も持たないため、明示的に与える。
              // `<title>` だけでは「押せるもの」として読まれないので `aria-label` も置く。
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={
                art
                  ? t('design.spotWork', { n: pos + 1, title: art.title || t('common.untitled') })
                  : t('design.spotEmpty', { n: pos + 1 })
              }
              aria-pressed={isPicked}
              onKeyDown={(e) =>
                onKeyActivate(e, {
                  slot: slotIdx,
                  workId: current[slotIdx] ?? null,
                  fromSlot: current[slotIdx] != null ? slotIdx : null,
                })
              }
            >
              <title>
                {art
                  ? t('design.spotWork', { n: pos + 1, title: art.title || t('common.untitled') })
                  : t('design.spotEmpty', { n: pos + 1 })}
              </title>
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
              {!art && <text className="pe-slot-num" x={0} y={0.16}>{pos + 1}</text>}
            </g>
          )
        })}
      </svg>

      {/* Points from the tray up into the map — drag a work up to hang it. */}
      <div className="place-arrow" aria-hidden="true">↑</div>

      {/* The tray: every work, 5 per row. A hung work is dimmed and badged (top-left) with
          the spot number it's on, plus a ✕ (top-right) to take it off the wall without
          picking it up first; the picked-up work is ringed. A work already hung in a
          DIFFERENT room gets its own marker so it's clear it's not exclusive to this room
          （ユーザー指示 2026-08-11）。 */}
      <div className="place-tray" role="list" aria-label={t('me.placementTrayLabel')}>
        {trayWorks.map((art) => {
          const src = thumb(art)
          const pos = placedPos.get(art.id)
          // Which slot this work already hangs on, if any — a tray-initiated drag/tap
          // must carry this like a map-initiated one does. Passing `null` here (as if the
          // work were unplaced) skipped the "swap the two" branch in `drop()`, so dragging
          // an already-hung work from the tray onto an occupied slot silently dropped
          // whatever was there instead of swapping it into this work's old spot (bug
          // report 2026-08-12: 「できる作品とできない作品がある」— it depended on
          // whether the piece being dragged happened to already be on the wall).
          const fromSlot = pos ? current.indexOf(art.id) : null
          const isPicked = picked?.workId === art.id
          const guest = guestIds.has(art.id)
          const elsewhere = placedElsewhere?.has(art.id) ?? false
          const baseTitle = guest
            ? `${art.title || t('common.untitled')} — ${art.artist}`
            : art.title || t('common.untitled')
          return (
            <div
              key={art.id}
              role="listitem"
              className={`place-tray-item${pos ? ' placed' : ''}${isPicked ? ' picked' : ''}${drag?.workId === art.id ? ' dragging' : ''}${disabled ? '' : ' grab'}${guest ? ' guest' : ''}`}
              title={elsewhere ? `${baseTitle} — ${t('me.placementElsewhereHint')}` : baseTitle}
              // キーボードで作品を持ち上げられるようにする（ユーザー決定 2026-08-12）。
              // `role="listitem"` は残す（トレイは `role="list"`）。押せることは
              // `tabIndex` + `aria-pressed` + `title`（アクセシブルネーム）で伝える。
              tabIndex={disabled ? -1 : 0}
              aria-pressed={isPicked}
              onKeyDown={(e) => onKeyActivate(e, { slot: null, workId: art.id, fromSlot })}
              onPointerDown={(e) => {
                if (disabled || (e.button != null && e.button > 0)) return
                e.preventDefault()
                press(e.currentTarget, e.pointerId, art.id, fromSlot, e.clientX, e.clientY)
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
              {pos && !disabled && (
                <button
                  type="button"
                  className="place-tray-remove"
                  aria-label={t('me.placementRemove')}
                  title={t('me.placementRemove')}
                  onPointerDown={(e) => {
                    // Stop the press from bubbling to the tile's own onPointerDown (which
                    // would double up on the tile's `press()` call below), but still start
                    // a press HERE — so a drag that begins on this small ✕ corner still
                    // picks the work up instead of silently doing nothing (2026-08-11 bug:
                    // stopPropagation alone swallowed the press entirely, so grabbing near
                    // the badge/✕ corner of a placed tile could not start a drag).
                    if (disabled || (e.button != null && e.button > 0)) return
                    e.stopPropagation()
                    press(e.currentTarget, e.pointerId, art.id, fromSlot, e.clientX, e.clientY)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (justDraggedRef.current) return
                    const slot = current.indexOf(art.id)
                    if (slot >= 0) removeSlot(slot)
                  }}
                >
                  ×
                </button>
              )}
              {elsewhere && (
                <span className="place-tray-elsewhere" aria-hidden="true" />
              )}
              {/* 作家名は**タイルの上に出す**（title 属性だけだとタッチでは読めない）。 */}
              {guest && <span className="place-tray-artist">{art.artist}</span>}
            </div>
          )
        })}
      </div>

      {/* A hung work that's been picked (tapped) — offer to take it off the wall, so
          removal has a tap path too (dragging it onto the tray does the same). */}
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
