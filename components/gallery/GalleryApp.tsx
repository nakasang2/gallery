'use client'
// 3D gallery core: R3F Canvas + HUD/panels + guided tour
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { LAYOUTS } from '@/lib/presets'
import { useExhibitionList } from '@/lib/exhibition'
import { useGallery } from '@/lib/store'
import { walkRef, LOW_POWER } from '@/lib/controller'
import { galleryAudio } from '@/lib/audio'
import { unlockVideoAudio } from '@/lib/videohub'
import GalleryScene from './GalleryScene'
import { HudTop, HudActions, Hint } from './Hud'
import ArtworkPanel from './ArtworkPanel'
import SettingsPanel from './SettingsPanel'
import Joystick from './Joystick'

function LoadingOverlay({ done }: { done: boolean }) {
  return (
    <div id="loading" className={done ? 'done' : ''}>
      <div className="loading-inner">
        <div className="loading-logo">HAKONIWA</div>
        <div className="loading-bar"><span></span></div>
        <div className="loading-text">Preparing the gallery…</div>
      </div>
    </div>
  )
}

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

export default function GalleryApp() {
  const ready = useGallery((s) => s.ready)
  const [loadingDone, setLoadingDone] = useState(false)
  const entryRef = useRef(LAYOUTS[useGallery.getState().layout].entry)

  useTour()

  // Prototype: expose internal state on the console for inspection
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__hakoniwa = { store: useGallery, walkRef }
    useGallery.getState().initAuth()
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
      entryRef.current = LAYOUTS[useGallery.getState().layout].entry
      setTimeout(() => alive && setLoadingDone(true), 500)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      {ready && (
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

      <HudTop />
      <Hint />
      <HudActions />
      <Joystick />
      <ArtworkPanel />
      <SettingsPanel />
      <LoadingOverlay done={loadingDone} />
    </>
  )
}
