'use client'
// Bakes one published room's wall shadows once, in the artist's browser, and saves the
// result — the producer side of DECISIONS 2026-08-18 ①.
//
// Mounted by the dashboard **while a progress indicator is on screen** (ユーザー指摘
// 2026-08-18: 「裏で進める形にすると、ユーザーが明示的に待たなくなってしまう。画像
// アップロード中に離脱する人はいない。ここも同様の体験にすべき」). The canvas itself is
// 1px and parked off-screen — like an upload, the artist watches the progress, not the
// bytes. Keeping it on-screen (rather than `display: none`) matters: a hidden element
// gets no animation frames, and this bakes one work per frame.
//
// What goes into the canvas is only what CASTS a shadow: `Room` (benches, partitions)
// and the exhibits. Nothing else in the real scene has `castShadow` — RoomPortals
// deliberately omits it, GhostVisitors sets it false, TitleWall has none — so this
// produces the same silhouettes the visitor's own bake would, and that claim is
// checkable by reading pixels back from both.
//
// The input is the PUBLISHED exhibition, not the dashboard's draft. The visitor derives
// its fingerprint from what the public page serves, so baking from anything else would
// save a bake that is stale the moment it lands.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { visitorSettings, buildPlacement, frameKeyFor, matKeyFor, hangingKeyFor, captionKeyFor, lightModeFor } from '@/lib/exhibition'
import { frameDefFor, applyMat, resolveLayout, resolveTheme, HANGINGS, CAPTIONS } from '@/lib/presets'
import type { PublicExhibition } from '@/lib/publish'
import { encodeAtlasPng, saveShadowBake, type SaveShadowBakeResult } from '@/lib/shadowBakeClient'
import Room from './Room'
import Exhibit from './Exhibit'
import WallShadowBaker from './WallShadowBaker'
import { buildBakePlan } from './bakePlan'

export interface BakeProgress {
  done: number
  total: number
}

export default function ShadowBakeRunner({
  exhibition,
  onProgress,
  onFinished,
}: {
  exhibition: PublicExhibition
  onProgress: (p: BakeProgress) => void
  onFinished: (r: SaveShadowBakeResult) => void
}) {
  const settings = useMemo(() => visitorSettings(exhibition), [exhibition])
  const theme = resolveTheme(settings.theme, settings.designOverrides)
  const layout = resolveLayout(settings.layout, settings.layoutParams)
  const { list, slots } = useMemo(
    () => buildPlacement(settings, exhibition.artworks),
    [settings, exhibition.artworks]
  )
  const plan = useMemo(() => buildBakePlan(settings, list, slots, layout), [settings, list, slots, layout])
  const doneRef = useRef(0)

  // 総数は焼き始める前に分かっているので、最初に1回だけ知らせる。**「準備中」のような
  // 定型句を出さないため** ── 状態を語る文言はその状態を決めている値から導出する
  // （AGENTS.md 5.3・`check:i18n` が定型句を検出する）。
  useEffect(() => {
    onProgress({ done: 0, total: plan.specs.length })
  }, [onProgress, plan.specs.length])

  const onBaked = useCallback(() => {
    doneRef.current += 1
    onProgress({ done: doneRef.current, total: plan.specs.length })
  }, [onProgress, plan.specs.length])

  if (plan.specs.length === 0) return null

  return (
    // 1px, off-screen, but NOT hidden — see the note at the top of this file.
    <div style={{ position: 'fixed', left: -20, top: 0, width: 1, height: 1, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden>
      <Canvas
        shadows
        // The visible render is one pixel; the work happens in the 2048px shadow map
        // and the 256px tiles, neither of which cares about this. `dpr: 1` keeps a
        // retina screen from quadrupling that one pixel for nothing.
        dpr={1}
        gl={{ antialias: false }}
        camera={{ position: [0, 1.6, 0], fov: 50 }}
      >
        <Room theme={theme} layout={layout} />
        {list.map((art, i) => (
          <Exhibit
            key={art.id}
            art={art}
            index={i}
            slot={layout.slots[slots[i]]}
            theme={theme}
            castRealShadow={false}
            frameDef={applyMat(frameDefFor(frameKeyFor(settings, art)), matKeyFor(settings, art))}
            hangingDef={HANGINGS[hangingKeyFor(settings, art)] ?? HANGINGS.wire}
            captionDef={CAPTIONS[captionKeyFor(settings, art)] ?? CAPTIONS.side}
            lightMode={lightModeFor(settings, art)}
          />
        ))}
        <BakeProgressReporter onBaked={onBaked} plan={plan} exhibition={exhibition} onFinished={onFinished} />
      </Canvas>
    </div>
  )
}

/** Wires the per-tile callback to the reporter and the finished atlas to the saver. */
function BakeProgressReporter({
  onBaked,
  plan,
  exhibition,
  onFinished,
}: {
  onBaked: () => void
  plan: ReturnType<typeof buildBakePlan>
  exhibition: PublicExhibition
  onFinished: (r: SaveShadowBakeResult) => void
}) {
  const gl = useThree((s) => s.gl)
  const sent = useRef(false)

  const allBaked = useCallback(
    (atlas: THREE.WebGLRenderTarget, cols: number, rows: number, tile: number) => {
      if (sent.current) return
      sent.current = true
      void (async () => {
        try {
          const png = await encodeAtlasPng(gl, atlas)
          onFinished(
            await saveShadowBake({
              galleryId: exhibition.galleryId,
              bakeKey: plan.key,
              ids: plan.ids,
              cols,
              rows,
              tile,
              png,
            })
          )
        } catch (e) {
          onFinished({ ok: false, skipped: false, reason: e instanceof Error ? e.message : 'encode' })
        }
      })()
    },
    [gl, exhibition.galleryId, plan, onFinished]
  )

  return (
    <WallShadowBaker specs={plan.specs} bakeKey={plan.key} onBaked={onBaked} onAllBaked={allBaked} />
  )
}
