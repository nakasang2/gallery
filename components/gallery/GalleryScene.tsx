'use client'
// シーン全体の組み立て(テーマ/レイアウト/展示リストの反映と静的シャドウの焼き込み)
import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { THEMES, LAYOUTS, FRAMES } from '@/lib/presets'
import { currentExhibitionList, frameKeyFor } from '@/lib/exhibition'
import { useSettings } from '@/lib/store'
import { LOW_POWER } from '@/lib/controller'
import Room from './Room'
import Exhibit from './Exhibit'
import TitleWall from './TitleWall'
import Dust from './Dust'
import WalkControls from './WalkControls'
import Effects from './Effects'

export default function GalleryScene() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  const settings = useSettings()
  const theme = THEMES[settings.theme]
  const layout = LAYOUTS[settings.layout]
  const list = currentExhibitionList(settings)

  // 環境マップ: 床のツヤや額縁の金属部分に室内の光がうっすら映り込む
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    scene.environmentIntensity = 0.3
    pmrem.dispose()
    return () => {
      scene.environment = null
      envTex.dispose()
    }
  }, [gl, scene])

  // 背景と霧
  useEffect(() => {
    scene.background = new THREE.Color(theme.fog)
    scene.fog = new THREE.FogExp2(theme.fog, 0.016)
  }, [scene, theme])

  // シーンは静的なので、構成が変わったときに一度だけ影を焼き直す
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      gl.shadowMap.needsUpdate = true
    })
    return () => cancelAnimationFrame(id)
  }, [gl, settings.theme, settings.layout, settings.frame, settings.showDemo, settings.artworks, settings.frameOverrides])

  return (
    <>
      <Room theme={theme} layout={layout} />
      {list.map((art, i) => (
        <Exhibit
          key={art.id}
          art={art}
          index={i}
          slot={layout.slots[i]}
          theme={theme}
          frameDef={FRAMES[frameKeyFor(settings, art)]}
        />
      ))}
      <TitleWall theme={theme} layout={layout} />
      <Dust layout={layout} />
      <WalkControls layout={layout} list={list} />
      {!LOW_POWER && <Effects />}
    </>
  )
}
