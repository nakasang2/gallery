'use client'
// 3D gallery core: R3F Canvas + HUD/panels + guided tour
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
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

  // Restore settings only after the canvas text fonts have loaded (up to 1.5s)
  useEffect(() => {
    let alive = true
    Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => {
      if (!alive) return
      useGallery.getState().hydrate()
      entryRef.current = resolveLayout(useGallery.getState().layout, useGallery.getState().layoutParams).entry
      setTimeout(() => alive && setLoadingDone(true), 500)
    })
    return () => {
      alive = false
    }
  }, [])

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
          className="stage-root"
          gl={{ antialias: true }}
          dpr={dpr}
          camera={{ fov: 60, near: 0.1, far: 100, position: [entryRef.current.x, 1.6, entryRef.current.z] }}
          onCreated={({ gl, camera }) => {
            camera.rotation.order = 'YXZ'
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = 1.1
            // The scene is static, so shadows are baked (GalleryScene sets needsUpdate).
            // PCFSoft + per-light shadow radius gives soft, natural penumbra edges
            // instead of the hard stair-stepped CG look (sampled at render, so it
            // still applies to the baked maps). The low tier skips real shadows
            // entirely — the art-directed shadow planes carry the depth cues.
            gl.shadowMap.enabled = QUALITY !== 'low'
            gl.shadowMap.type = THREE.PCFSoftShadowMap
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
      {/* Personalised for a public gallery (visitor mode), house-branded on /demo */}
      <LoadingScreen exhibition={visitor} done={loadingDone} />
    </>
  )
}
