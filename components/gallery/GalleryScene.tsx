'use client'
// シーン全体の組み立て(テーマ/レイアウト/展示リストの反映と静的シャドウの焼き込み)
import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { THEMES, LAYOUTS, FRAMES } from '@/lib/presets'
import { useExhibitionList, frameKeyFor } from '@/lib/exhibition'
import { useSettings } from '@/lib/store'
import { LOW_POWER } from '@/lib/controller'
import Room from './Room'
import Exhibit from './Exhibit'
import TitleWall from './TitleWall'
import Dust from './Dust'
import WalkControls from './WalkControls'
import Effects from './Effects'
import { VideoPlaybackManager } from './VideoArt'
import { getListener } from '@/lib/videohub'

export default function GalleryScene() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  // 空間オーディオのリスナー(耳)をカメラに付ける
  useEffect(() => {
    const listener = getListener()
    camera.add(listener)
    // プロトタイプ用デバッグ
    ;(window as unknown as Record<string, unknown>).__scene = scene
    ;(window as unknown as Record<string, unknown>).__gl = gl
    return () => {
      camera.remove(listener)
    }
  }, [camera, scene])

  const settings = useSettings()
  // 公開データのキーが古い可能性に備えてフォールバック
  const theme = THEMES[settings.theme] ?? THEMES.chic
  const layout = LAYOUTS[settings.layout] ?? LAYOUTS.hall
  const list = useExhibitionList()

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

  // 背景と霧(テーマ別の濃度で空気遠近感を出す)
  useEffect(() => {
    scene.background = new THREE.Color(theme.fog)
    scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity)
  }, [scene, theme])

  // シーンは静的なので、構成が変わったときに一度だけ影を焼き直す。
  // あわせて全マテリアルを再コンパイルさせる: 展示の入れ替えでシャドウ付きライトが
  // 作り直されると、ライト数が同じ場合に three がプログラムを再利用し、古い
  // シャドウサンプラと新しいシャドウマップの型不整合で描画が全滅するため
  // (GL_INVALID_OPERATION: Mismatch between texture format and sampler type)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.material) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) m.needsUpdate = true
      })
      gl.shadowMap.needsUpdate = true
    })
    return () => cancelAnimationFrame(id)
  }, [gl, scene, settings.theme, settings.layout, settings.frame, settings.frameOverrides, list])

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
      <VideoPlaybackManager />
      {!LOW_POWER && <Effects />}
    </>
  )
}
