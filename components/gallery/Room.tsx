'use client'
// 部屋(床・天井・壁・巾木・廻り縁・中央壁・照明ライン・ベンチ・全体照明)
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { CEIL_H, type LayoutDef, type ThemeDef } from '@/lib/presets'
import { walkRef } from '@/lib/controller'
import { getFloorTextures, getPlasterBump, getPlasterNormal, disposeAll } from './textures'
import SpotWithTarget from './SpotWithTarget'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

// RectAreaLight(天窓)を使うための一度きりの初期化
let rectAreaInited = false
if (typeof window !== 'undefined' && !rectAreaInited) {
  RectAreaLightUniformsLib.init()
  rectAreaInited = true
}

const TRIM_COLOR = 0x0e0c0a

// 壁の漆喰マップ(ノーマル + 艶ムラ用ラフネス)。実寸に合わせてタイリング
function useWallMaps(widthM: number) {
  const maps = useMemo(() => {
    const rep: [number, number] = [widthM / 3.2, CEIL_H / 3.2]
    const normalMap = getPlasterNormal().clone()
    normalMap.repeat.set(...rep)
    const roughnessMap = getPlasterBump().clone()
    roughnessMap.repeat.set(...rep)
    return { normalMap, roughnessMap }
  }, [widthM])
  useEffect(() => () => disposeAll([maps.normalMap, maps.roughnessMap]), [maps])
  return maps
}

function Wall({
  width,
  color,
  position,
  rotationY,
}: {
  width: number
  color: number
  position: [number, number, number]
  rotationY: number
}) {
  const { normalMap, roughnessMap } = useWallMaps(width)
  return (
    <mesh position={position} rotation-y={rotationY} receiveShadow>
      <planeGeometry args={[width, CEIL_H]} />
      {/* ノーマルマップで斜めからの光を拾い、ラフネスマップで艶ムラを出す */}
      <meshStandardMaterial
        color={color}
        roughness={0.93}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(0.6, 0.6)}
        roughnessMap={roughnessMap}
        envMapIntensity={0.25}
      />
    </mesh>
  )
}

function Trim({ w, x, z, rotY, y, h, d }: { w: number; x: number; z: number; rotY: number; y: number; h: number; d: number }) {
  return (
    <mesh position={[x, y, z]} rotation-y={rotY}>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
    </mesh>
  )
}

function Bench({ x, z, theme }: { x: number; z: number; theme: ThemeDef }) {
  // 座面は床と同じ木目テクスチャを濃い色味で使い回す
  const topTex = useMemo(() => {
    const t = getFloorTextures().map.clone()
    t.repeat.set(0.5, 0.14)
    return t
  }, [])
  useEffect(() => () => disposeAll([topTex]), [topTex])
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.09, 0.55]} />
        <meshStandardMaterial map={topTex} color={0x8a6a4a} roughness={0.62} />
      </mesh>
      {[-0.85, 0.85].map((lx) => (
        <mesh key={lx} position={[lx, 0.22, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.08, 0.44, 0.45]} />
          <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
        </mesh>
      ))}
      {/* ベンチ直上のダウンライト(接地影を落とす) */}
      <SpotWithTarget
        position={[0, CEIL_H - 0.1, 0]}
        targetPosition={[0, 0, 0]}
        color={theme.spotColor}
        intensity={16}
        angle={1.05}
        penumbra={0.9}
        decay={1.6}
        castShadow
      />
    </group>
  )
}

export default function Room({ theme, layout }: { theme: ThemeDef; layout: LayoutDef }) {
  const { hw, hd } = layout
  const h = CEIL_H

  // 床: 板目の実寸を保つ(1タイルあたり約5.3m × 2.7m)
  const floorTex = useMemo(() => {
    const base = getFloorTextures()
    const out = {
      map: base.map.clone(),
      bumpMap: base.bumpMap.clone(),
      roughnessMap: base.roughnessMap.clone(),
    }
    for (const t of Object.values(out)) t.repeat.set((hw * 2) / 5.3, (hd * 2) / 2.66)
    return out
  }, [hw, hd])
  useEffect(() => () => disposeAll(Object.values(floorTex)), [floorTex])

  const partitionMaps = useWallMaps(8)

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return // ドラッグだった
    walkRef.current?.walkTo(e.point)
  }

  // 天井の間接照明ラインの本数(部屋の奥行きに応じて)
  const stripZs = useMemo(() => {
    const n = Math.max(1, Math.floor(hd / 2.5))
    return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 4)
  }, [hd])

  return (
    <group>
      {/* 床 */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow onClick={onFloorClick}>
        <planeGeometry args={[hw * 2, hd * 2]} />
        <meshPhysicalMaterial
          {...floorTex}
          color={theme.floorTint}
          bumpScale={0.5}
          roughness={0.85}
          clearcoat={0.45}
          clearcoatRoughness={0.35}
          envMapIntensity={1.1}
        />
      </mesh>

      {/* 天井 */}
      <mesh rotation-x={Math.PI / 2} position={[0, h, 0]}>
        <planeGeometry args={[hw * 2, hd * 2]} />
        <meshStandardMaterial color={theme.ceiling} roughness={0.95} />
      </mesh>

      {/* 壁(西面はタイトルウォール用のアクセント色) */}
      <Wall width={hw * 2} color={theme.wall} position={[0, h / 2, -hd]} rotationY={0} />
      <Wall width={hw * 2} color={theme.wall} position={[0, h / 2, hd]} rotationY={Math.PI} />
      <Wall width={hd * 2} color={theme.wall} position={[hw, h / 2, 0]} rotationY={-Math.PI / 2} />
      <Wall width={hd * 2} color={theme.accentWall} position={[-hw, h / 2, 0]} rotationY={Math.PI / 2} />

      {/* 巾木と廻り縁 */}
      {(
        [
          [hw * 2, 0, -hd + 0.02, 0],
          [hw * 2, 0, hd - 0.02, 0],
          [hd * 2, hw - 0.02, 0, Math.PI / 2],
          [hd * 2, -hw + 0.02, 0, Math.PI / 2],
        ] as [number, number, number, number][]
      ).map(([w, x, z, rotY], i) => (
        <group key={i}>
          <Trim w={w} x={x} z={z} rotY={rotY} y={0.06} h={0.12} d={0.04} />
          <Trim w={w} x={x} z={z} rotY={rotY} y={h - 0.09} h={0.18} d={0.07} />
        </group>
      ))}

      {/* 中央の自立壁(レイアウトによる) */}
      {layout.partitions.map((p, i) => (
        <group key={i}>
          <mesh position={[p.x, p.h / 2, p.z]} castShadow receiveShadow>
            <boxGeometry args={[p.w, p.h, p.t]} />
            <meshStandardMaterial
              color={theme.accentWall}
              roughness={0.95}
              normalMap={partitionMaps.normalMap}
              normalScale={new THREE.Vector2(0.6, 0.6)}
              roughnessMap={partitionMaps.roughnessMap}
              envMapIntensity={0.25}
            />
          </mesh>
          <mesh position={[p.x, p.h + 0.03, p.z]}>
            <boxGeometry args={[p.w + 0.06, 0.06, p.t + 0.06]} />
            <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
          </mesh>
        </group>
      ))}

      {/* 天井の間接照明ライン(HDRで発光させてブルームに乗せる) */}
      {stripZs.map((z) => (
        <mesh key={z} position={[0, h - 0.02, z]}>
          <boxGeometry args={[hw * 1.6, 0.02, 0.09]} />
          <meshStandardMaterial color={0x000000} emissive={theme.stripColor} emissiveIntensity={2.4} />
        </mesh>
      ))}

      {/* ピクチャーレール(額の吊りワイヤーを受ける細いレール) */}
      {(
        [
          [hw * 2, 0, -hd + 0.05, 0],
          [hw * 2, 0, hd - 0.05, 0],
          [hd * 2, hw - 0.05, 0, Math.PI / 2],
          [hd * 2, -hw + 0.05, 0, Math.PI / 2],
        ] as [number, number, number, number][]
      ).map(([w, x, z, rotY], i) => (
        <mesh key={`rail-${i}`} position={[x, h - 0.34, z]} rotation-y={rotY}>
          <boxGeometry args={[w, 0.05, 0.035]} />
          <meshStandardMaterial color={0x1c1916} roughness={0.5} metalness={0.3} />
        </mesh>
      ))}

      {/* 天窓(ホワイトキューブ): 柔らかい自然光の面光源 */}
      {theme.skylight && (
        <group position={[0, h - 0.012, 0]}>
          <mesh rotation-x={Math.PI / 2}>
            <planeGeometry args={[Math.min(7, hw), Math.min(3.4, hd * 0.8)]} />
            <meshStandardMaterial color={0x000000} emissive={0xf3f6ff} emissiveIntensity={1.5} />
          </mesh>
          <mesh position={[0, 0.005, 0]}>
            <boxGeometry args={[Math.min(7, hw) + 0.16, 0.06, Math.min(3.4, hd * 0.8) + 0.16]} />
            <meshStandardMaterial color={0xdcd8d0} roughness={0.9} />
          </mesh>
          <rectAreaLight
            args={[0xf3f6ff, 3.2, Math.min(7, hw), Math.min(3.4, hd * 0.8)]}
            rotation-x={-Math.PI / 2}
          />
        </group>
      )}

      {/* ベンチ */}
      {layout.benches.map((b) => (
        <Bench key={`${b.x},${b.z}`} x={b.x} z={b.z} theme={theme} />
      ))}

      {/* 環境光は控えめにして、影とスポットライトのコントラストを立たせる */}
      <ambientLight color={0xfff4e0} intensity={theme.ambient} />
      <hemisphereLight color={0xfff8ea} groundColor={0x4a4136} intensity={theme.hemi} />
    </group>
  )
}
