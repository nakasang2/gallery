'use client'
// 3D gallery core: R3F Canvas + HUD/panels + guided tour
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { PerformanceMonitor, useProgress } from '@react-three/drei'
import { resolveLayout, THEMES } from '@/lib/presets'
import { useExhibitionList } from '@/lib/exhibition'
import { demoDesignOverrides } from '@/lib/artworks'
import { useGallery } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { walkRef, canvasRef, QUALITY } from '@/lib/controller'
import { galleryAudio } from '@/lib/audio'
import { audioGuide } from '@/lib/guide'
import { unlockVideoAudio, suspendVideoAudio } from '@/lib/videohub'
import GalleryScene from './GalleryScene'
import FlatGallery from './FlatGallery'
import MiniMap from './MiniMap'
import { HudTop, HudActions, HudStepper, Hint } from './Hud'
import ArtworkPanel from './ArtworkPanel'
import InfoPanel from './InfoPanel'
import SettingsPanel from './SettingsPanel'
import GuestbookPanel from './GuestbookPanel'
import LoadingScreen from './LoadingScreen'

// three's `fov` is the VERTICAL angle, so a portrait phone keeps the 60° height
// and pays for it in width: 390×844 sees only 29.9° horizontally where a laptop
// sees 85.5°. A visitor arriving from a shared link got a third of the room and
// a wall of floor. Below REF_ASPECT we solve for the vertical angle that holds
// the horizontal view steady, capped at MAX_FOV so a tall phone doesn't fish-eye
// the space. At and above REF_ASPECT nothing changes — desktop framing is tuned
// (docs/DECISIONS 2026-07-23) and must stay exactly as it is.
const BASE_FOV = 60
const REF_ASPECT = 1.3
const MAX_FOV = 78
const REF_HALF_TAN = Math.tan((BASE_FOV * Math.PI) / 360) * REF_ASPECT

function portraitFov(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect >= REF_ASPECT) return BASE_FOV
  const v = (2 * Math.atan(REF_HALF_TAN / aspect) * 180) / Math.PI
  return Math.min(MAX_FOV, v)
}

/** Keeps the camera's field of view honest across rotation and resize. */
function AdaptiveFov() {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    if (!cam.isPerspectiveCamera) return
    const fov = portraitFov(width / Math.max(1, height))
    if (Math.abs(cam.fov - fov) < 0.01) return
    cam.fov = fov
    cam.updateProjectionMatrix()
  }, [camera, width, height])
  return null
}

/** Watches for the GPU context going away and coming back.
 *
 *  Lives inside the Canvas on purpose. The obvious places both failed: a parent
 *  effect runs before R3F has built the canvas (it saw a null ref and attached
 *  nothing), and `onCreated` turned out never to fire here at all — verified by
 *  the `touchAction` it is supposed to set still being unset on the live canvas.
 *  `useThree` is the one path that is guaranteed to see a real renderer.
 *
 *  preventDefault() is what actually buys the recovery: the default action for
 *  `webglcontextlost` is to never restore the context, and iOS Safari drops it
 *  routinely on app switch or memory pressure. Without this the room simply
 *  stays black — and because the initial WebGL probe succeeded, it never falls
 *  back to the 2D list either. */
function ContextGuard({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const lost = (e: Event) => {
      e.preventDefault()
      onLost()
    }
    const restored = () => onRestored()
    el.addEventListener('webglcontextlost', lost)
    el.addEventListener('webglcontextrestored', restored)
    return () => {
      el.removeEventListener('webglcontextlost', lost)
      el.removeEventListener('webglcontextrestored', restored)
    }
  }, [gl, onLost, onRestored])
  return null
}

// Non-blocking notice for errors/limits hit while walking the room (see lib/toast)
function Toast() {
  const msg = useToast()
  return (
    <div className={`gallery-toast${msg ? ' show' : ''}`} role="status" aria-live="polite">
      {msg}
    </div>
  )
}

// Guided tour: focus works in order, pausing to view each before moving on.
// Live tour: hold each work at least MIN_DWELL, then wait for its narration to
// finish (MAX_DWELL ceiling so a long/stuck guide can't stall). Recording run:
// a brisk fixed dwell — the WebM captures video only, so there's no narration to
// wait for and short beats keep the shareable clip tight.
const MIN_DWELL_MS = 6200
const MAX_DWELL_MS = 30_000
const REC_DWELL_MS = 6200
function useTour() {
  const tourActive = useGallery((s) => s.tourActive)
  const count = useExhibitionList().length

  useEffect(() => {
    if (!tourActive) return
    const recording = useGallery.getState().tourRecording
    let idx = 0
    let minTimer: ReturnType<typeof setTimeout> | undefined
    let maxTimer: ReturnType<typeof setTimeout> | undefined
    let unsub: (() => void) | undefined
    useGallery.getState().setSettingsOpen(false)

    const clearStep = () => {
      if (minTimer) clearTimeout(minTimer)
      if (maxTimer) clearTimeout(maxTimer)
      unsub?.()
      unsub = undefined
    }
    const next = () => {
      clearStep()
      idx++
      if (idx >= count) {
        useGallery.getState().setTourActive(false)
        return
      }
      step()
    }
    const step = () => {
      walkRef.current?.focusExhibit(idx)
      if (recording) {
        minTimer = setTimeout(next, REC_DWELL_MS)
        return
      }
      let advanced = false
      const advance = () => {
        if (advanced) return
        advanced = true
        next()
      }
      // After the minimum dwell, move on as soon as the narration isn't playing;
      // if it's still going, wait for it to end. MAX_DWELL is the hard ceiling.
      minTimer = setTimeout(() => {
        if (!audioGuide.playing) {
          advance()
          return
        }
        unsub = audioGuide.subscribe(() => {
          if (!audioGuide.playing) advance()
        })
      }, MIN_DWELL_MS)
      maxTimer = setTimeout(advance, MAX_DWELL_MS)
    }
    step()
    return () => clearStep()
  }, [tourActive, count])
}

export default function GalleryApp({ onShellReady, demoTheme, demo = false }: { onShellReady?: () => void; demoTheme?: string | null; demo?: boolean }) {
  const ready = useGallery((s) => s.ready)
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)

  // The /demo house showcase populates a fixed ambient crowd (no real visit count).
  // Flag it in the store so GhostVisitors knows; clear it when leaving.
  useEffect(() => {
    useGallery.getState().setDemoMode(demo)
    return () => useGallery.getState().setDemoMode(false)
  }, [demo])
  const [loadingDone, setLoadingDone] = useState(false)
  // iOS Safari drops the WebGL context aggressively — switch apps, take a call,
  // open a few tabs, and the room comes back black. There was no handler at all,
  // and the initial `webgl` probe already succeeded, so it never fell through to
  // FlatGallery either: the visitor just sat in front of nothing until they
  // thought to reload. `canvasKey` rebuilds the scene against a fresh context.
  const [canvasKey, setCanvasKey] = useState(0)
  const [contextLost, setContextLost] = useState(false)
  const handleContextLost = useCallback(() => setContextLost(true), [])
  const handleContextRestored = useCallback(() => {
    setContextLost(false)
    setCanvasKey((k) => k + 1) // rebuild the scene against the new context
  }, [])
  // Settings hydrated + canvas fonts ready. Used to be the whole story, which is
  // why the door opened on a timer while the room was still empty.
  const [hydrated, setHydrated] = useState(false)
  const [waitedOut, setWaitedOut] = useState(false)
  // Every file-backed asset in the room goes through three's default loading
  // manager — artwork images (components/gallery/textures.ts `texLoader`), video
  // posters, the floor/wall maps and the ghost GLBs (useGLTF) — so this is a real
  // measure of "is the room actually there yet".
  const { active: assetsLoading, loaded: assetsLoaded, total: assetsTotal } = useProgress()
  const assetsIdle = !assetsLoading && assetsLoaded >= assetsTotal
  const loadPct = assetsTotal > 0 ? Math.round((Math.min(assetsLoaded, assetsTotal) / assetsTotal) * 100) : 0
  // null = still detecting; false = no WebGL → 2D list fallback
  const [webgl, setWebgl] = useState<boolean | null>(null)
  // Render resolution per quality tier. The high tier starts at native retina and
  // steps down when PerformanceMonitor sees sustained low FPS (weak iGPU laptops).
  const [dpr, setDpr] = useState<[number, number]>(
    QUALITY === 'high' ? [1, 2] : QUALITY === 'medium' ? [1, 1.5] : [1, 1.25]
  )
  const entryRef = useRef(
    resolveLayout(useGallery.getState().layout, useGallery.getState().layoutParams).entry
  )

  useTour()

  useEffect(() => {
    try {
      const c = document.createElement('canvas')
      setWebgl(!!(c.getContext('webgl2') || c.getContext('webgl')))
    } catch {
      setWebgl(false)
    }
  }, [])

  // Prototype: expose internal state on the console for inspection
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__xibit360 = { store: useGallery, walkRef }
    useGallery.getState().initAuth()
    onShellReady?.() // our own LoadingScreen has taken over from any outer fallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ambient and video audio start on first interaction due to browser autoplay limits
  useEffect(() => {
    const unlock = () => {
      galleryAudio.unlock()
      // Owner-uploaded ambient BGM (§P3-12): loop the visitor gallery's track (null on
      // /demo or a room with none). Starts here because autoplay needs a user gesture.
      galleryAudio.setBgm(useGallery.getState().visitor?.bgmUrl ?? null)
      unlockVideoAudio()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      // Leaving the gallery: silence the ambient/video audio. Their contexts are
      // module singletons that outlive this component, so the loop would otherwise
      // keep playing on the landing page / dashboard after navigating away.
      galleryAudio.suspend()
      galleryAudio.setBgm(null) // stop the looping BGM source when leaving the gallery
      suspendVideoAudio()
      audioGuide.suspend() // stop any narration when leaving the gallery
      canvasRef.current = null // the canvas is gone once we unmount
    }
  }, [])

  // Restore settings only after the canvas text fonts have loaded (up to 1.5s).
  // The extra 500ms is the minimum dwell — it also gives the scene a beat to
  // register its first loads, so `assetsIdle` below can't read the empty gap
  // between mount and the first request as "finished".
  useEffect(() => {
    let alive = true
    Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => {
      if (!alive) return
      useGallery.getState().hydrate()
      entryRef.current = resolveLayout(useGallery.getState().layout, useGallery.getState().layoutParams).entry
      setTimeout(() => alive && setHydrated(true), 500)
    })
    return () => {
      alive = false
    }
  }, [])

  // A stalled or missing asset must never trap a visitor behind the door.
  useEffect(() => {
    const t = setTimeout(() => setWaitedOut(true), 12_000)
    return () => clearTimeout(t)
  }, [])

  // Open the doors once the room is really there. The 400ms is a debounce as much
  // as a beat: assets register in waves (GLBs, then artwork textures), and if a
  // new wave starts this effect re-runs and clears the timer.
  useEffect(() => {
    if (loadingDone || !hydrated) return
    if (!assetsIdle && !waitedOut) return
    const t = setTimeout(() => setLoadingDone(true), 400)
    return () => clearTimeout(t)
  }, [loadingDone, hydrated, assetsIdle, waitedOut])

  // Admin-set demo theme (/admin → Demo look): apply AFTER hydration settles
  // (loadingDone is set past both hydrate passes) so loadSettings can't clobber it.
  // Guest showcase only — never a signed-in owner's room or a real visitor page.
  useEffect(() => {
    if (loadingDone && demoTheme && !user && !visitor && THEMES[demoTheme]) {
      useGallery.getState().updateSettings({ theme: demoTheme })
    }
  }, [loadingDone, demoTheme, user, visitor])

  // /demo "sampler": seed a curated per-work look (varied frames/mats/hangings/
  // captions) so walking the showcase shows the range. In-memory only (setState, not
  // updateSettings) so it never persists into a guest's own localStorage settings.
  useEffect(() => {
    if (demo && loadingDone && !user && !visitor) {
      useGallery.setState(demoDesignOverrides())
    }
  }, [demo, loadingDone, user, visitor])

  return (
    <>
      {ready && webgl && (
        <Canvas
          key={canvasKey}
          className="stage-root"
          gl={{ antialias: true }}
          // Shadows MUST be declared here, not set manually in onCreated: R3F
          // re-applies this prop on every canvas reconfigure (e.g. the dpr
          // downgrade below), and an unset prop resets shadowMap.enabled=false —
          // which was silently killing every real shadow a few seconds after load.
          // 'percentage' = PCFShadowMap: three r185 removed PCFSoftShadowMap (it
          // force-downgrades to PCF with a warning); the soft penumbra comes from
          // each light's shadow-radius instead.
          shadows={QUALITY !== 'low' ? 'percentage' : false}
          dpr={dpr}
          camera={{ fov: 60, near: 0.1, far: 100, position: [entryRef.current.x, 1.6, entryRef.current.z] }}
          onCreated={({ gl, camera }) => {
            camera.rotation.order = 'YXZ'
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = 1.1
            // The scene is static, so shadows are baked (GalleryScene sets
            // needsUpdate; enabled/type come from the `shadows` prop above).
            // autoUpdate isn't managed by R3F, so setting it once here is safe.
            gl.shadowMap.autoUpdate = false
            gl.domElement.style.touchAction = 'none'
            canvasRef.current = gl.domElement // for the walkthrough recorder
          }}
        >
          {/* Weak-GPU desktops: after sustained low FPS, drop render resolution once
              (no onIncline restore — flipping back and forth is more jarring).
              Armed only after the loading screen so the shadow-bake/texture-load dip
              can't trigger it, and ignored while the tab is hidden (rAF throttling
              reads as low FPS there). */}
          {QUALITY === 'high' && loadingDone && (
            <PerformanceMonitor
              flipflops={2}
              onDecline={() => {
                if (document.visibilityState !== 'visible') return
                setDpr((d) => (d[1] > 1.5 ? [1, 1.5] : [1, 1.25])) // 2 → 1.5 → 1.25
              }}
            />
          )}
          <AdaptiveFov />
          <ContextGuard
            onLost={handleContextLost}
            onRestored={handleContextRestored}
          />
          <GalleryScene />
        </Canvas>
      )}
      {ready && webgl === false && <FlatGallery />}

      <HudTop />
      {webgl !== false ? (
        <>
          <Hint />
          <HudStepper />
          <MiniMap />
          <ArtworkPanel />
        </>
      ) : null}
      <HudActions />
      <InfoPanel />
      <SettingsPanel />
      <GuestbookPanel />
      <Toast />
      {/* The browser took the GPU away. Some devices hand it straight back (we
          rebuild automatically); iOS often waits until the page is interacted
          with, so give the visitor a way to ask. */}
      {contextLost && (
        <div className="ctx-lost" role="alert">
          <div className="ctx-lost-inner">
            <p className="ctx-lost-title">The room lost its connection to the graphics card.</p>
            <p className="ctx-lost-sub">This can happen when the phone is low on memory or you switch apps.</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setContextLost(false)
                setCanvasKey((k) => k + 1)
              }}
            >
              Rebuild the room
            </button>
          </div>
        </div>
      )}

      {/* Personalised for a public gallery (visitor mode), house-branded on /demo */}
      <LoadingScreen exhibition={visitor} done={loadingDone} progress={assetsTotal > 0 ? loadPct : undefined} />
    </>
  )
}
