'use client'
// 3D gallery core: R3F Canvas + HUD/panels + guided tour
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { resolveLayout } from '@/lib/presets'
import { useExhibitionList } from '@/lib/exhibition'
import { useGallery } from '@/lib/store'
import { walkRef, LOW_POWER } from '@/lib/controller'
import { galleryAudio } from '@/lib/audio'
import { unlockVideoAudio } from '@/lib/videohub'
import GalleryScene from './GalleryScene'
import FlatGallery from './FlatGallery'
import MiniMap from './MiniMap'
import { HudTop, HudActions, HudStepper, Hint } from './Hud'
import ArtworkPanel from './ArtworkPanel'
import SettingsPanel from './SettingsPanel'
import GuestbookPanel from './GuestbookPanel'
import LoadingScreen from './LoadingScreen'

// Guided tour: focus works in order, pausing to view each before moving on
function useTour() {
  const tourActive = useGallery((s) => s.tourActive)
  const count = useExhibitionList().length

  useEffect(() => {
    if (!tourActive) return
    let idx = 0
    let timer: ReturnType<typeof setTimeout>
    useGallery.getState().setSettingsOpen(false)
    const step = () => {
      walkRef.current?.focusExhibit(idx)
      timer = setTimeout(() => {
        idx++
        if (idx >= count) {
          useGallery.getState().setTourActive(false)
          return
        }
        step()
      }, 6200)
    }
    step()
    return () => clearTimeout(timer)
  }, [tourActive, count])
}

export default function GalleryApp({ onShellReady }: { onShellReady?: () => void }) {
  const ready = useGallery((s) => s.ready)
  const visitor = useGallery((s) => s.visitor)
  const [loadingDone, setLoadingDone] = useState(false)
  // null = still detecting; false = no WebGL → 2D list fallback
  const [webgl, setWebgl] = useState<boolean | null>(null)
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
    ;(window as unknown as Record<string, unknown>).__hakoniwa = { store: useGallery, walkRef }
    useGallery.getState().initAuth()
    onShellReady?.() // our own LoadingScreen has taken over from any outer fallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ambient and video audio start on first interaction due to browser autoplay limits
  useEffect(() => {
    const unlock = () => {
      galleryAudio.unlock()
      unlockVideoAudio()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
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

  return (
    <>
      {ready && webgl && (
        <Canvas
          className="stage-root"
          gl={{ antialias: true }}
          dpr={[1, LOW_POWER ? 1.5 : 1.75]}
          camera={{ fov: 60, near: 0.1, far: 100, position: [entryRef.current.x, 1.6, entryRef.current.z] }}
          onCreated={({ gl, camera }) => {
            camera.rotation.order = 'YXZ'
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = 1.1
            // The scene is static, so shadows are baked (GalleryScene sets needsUpdate)
            gl.shadowMap.enabled = true
            gl.shadowMap.type = THREE.PCFShadowMap
            gl.shadowMap.autoUpdate = false
            gl.domElement.style.touchAction = 'none'
          }}
        >
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
      <SettingsPanel />
      <GuestbookPanel />
      {/* Personalised for a public gallery (visitor mode), house-branded on /demo */}
      <LoadingScreen exhibition={visitor} done={loadingDone} />
    </>
  )
}
