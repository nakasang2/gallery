'use client'
// 3Dギャラリーの本体: R3F Canvas + HUD/パネル類 + 順路ツアー
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { LAYOUTS } from '@/lib/presets'
import { useExhibitionList } from '@/lib/exhibition'
import { useGallery } from '@/lib/store'
import { walkRef, LOW_POWER } from '@/lib/controller'
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
        <div className="loading-text">ギャラリーを準備しています…</div>
      </div>
    </div>
  )
}

// 順路ツアー: 作品を順にフォーカスし、鑑賞の間を置いて次へ
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

  // プロトタイプ用: コンソールから内部状態を確認できるようにしておく
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__hakoniwa = { store: useGallery, walkRef }
    useGallery.getState().initAuth()
  }, [])

  // 設定の復元は、canvasに文字を描くフォントの読み込みを待ってから(最大1.5秒)
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
            // シーンは静的なので影は焼き込み方式(GalleryScene が needsUpdate を立てる)
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
