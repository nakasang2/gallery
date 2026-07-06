'use client'
// 1点の展示(額装 + 作品 + 銘板 + スポットライト + 照明器具)
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { ArtworkData } from '@/lib/artworks'
import { CEIL_H, type FrameDef, type SlotDef, type ThemeDef } from '@/lib/presets'
import { artSize } from '@/lib/exhibition'
import { walkRef, LOW_POWER } from '@/lib/controller'
import { getArtTexture, makePlaqueTexture, disposeAll } from './textures'
import SpotWithTarget from './SpotWithTarget'

// 面取り付きの額縁(中央をくり抜いた枠をベベル付きで押し出す)
function makeFrameGeo(w: number, h: number, bar: number, gap: number) {
  const outerW = w / 2 + gap + bar
  const outerH = h / 2 + gap + bar
  const innerW = w / 2 + gap
  const innerH = h / 2 + gap
  const shape = new THREE.Shape()
  shape.moveTo(-outerW, -outerH)
  shape.lineTo(outerW, -outerH)
  shape.lineTo(outerW, outerH)
  shape.lineTo(-outerW, outerH)
  shape.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-innerW, -innerH)
  hole.lineTo(-innerW, innerH)
  hole.lineTo(innerW, innerH)
  hole.lineTo(innerW, -innerH)
  hole.closePath()
  shape.holes.push(hole)
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.014,
    bevelSegments: 3,
  })
}

export default function Exhibit({
  art,
  index,
  slot,
  theme,
  frameDef,
}: {
  art: ArtworkData
  index: number
  slot: SlotDef
  theme: ThemeDef
  frameDef: FrameDef
}) {
  const gl = useThree((s) => s.gl)
  const { width, height } = artSize(art.ratio)
  const artTex = getArtTexture(art)

  const plaqueTex = useMemo(() => makePlaqueTexture(art, index), [art, index])
  useEffect(() => () => disposeAll([plaqueTex]), [plaqueTex])

  const frameless = frameDef.mat === null
  const frameGeo = useMemo(
    () => (frameless ? null : makeFrameGeo(width, height, frameDef.bar!, frameDef.gap!)),
    [frameless, width, height, frameDef]
  )
  useEffect(() => () => disposeAll([frameGeo]), [frameGeo])

  const halfW = frameless ? width / 2 : width / 2 + frameDef.gap! + frameDef.bar!

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 8) return // ドラッグだった
    walkRef.current?.focusExhibit(index)
  }
  const onOver = () => (gl.domElement.style.cursor = 'pointer')
  const onOut = () => (gl.domElement.style.cursor = '')

  // スポットライトの位置(壁の法線方向へ2.1m、天井際)
  const normal = useMemo(
    () => new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotY),
    [slot.rotY]
  )
  const lightPos = useMemo(() => {
    const p = new THREE.Vector3(slot.x, 0, slot.z).add(normal.clone().multiplyScalar(2.1))
    p.y = CEIL_H - 0.15
    return p
  }, [slot, normal])
  const fixtureQuat = useMemo(() => {
    const dir = new THREE.Vector3(slot.x, 1.62, slot.z).sub(lightPos).normalize()
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
  }, [slot, lightPos])

  return (
    <>
      <group position={[slot.x, 1.62, slot.z]} rotation-y={slot.rotY}>
        {frameless ? (
          // キャンバス張り: 枠なしで側面に厚みだけ見せる
          <mesh
            position={[0, 0, 0.028]}
            castShadow
            onClick={onClick}
            onPointerOver={onOver}
            onPointerOut={onOut}
          >
            <boxGeometry args={[width, height, 0.05]} />
            <meshStandardMaterial attach="material-0" color={0x28241f} roughness={0.8} />
            <meshStandardMaterial attach="material-1" color={0x28241f} roughness={0.8} />
            <meshStandardMaterial attach="material-2" color={0x28241f} roughness={0.8} />
            <meshStandardMaterial attach="material-3" color={0x28241f} roughness={0.8} />
            <meshStandardMaterial attach="material-4" map={artTex} roughness={0.75} envMapIntensity={0.35} />
            <meshStandardMaterial attach="material-5" color={0x1a1713} roughness={0.9} />
          </mesh>
        ) : (
          <>
            <mesh geometry={frameGeo!} position={[0, 0, 0.02]} castShadow>
              <meshStandardMaterial
                color={frameDef.color}
                roughness={frameDef.roughness}
                metalness={frameDef.metalness}
                envMapIntensity={0.9}
              />
            </mesh>
            {/* マット紙 */}
            <mesh position={[0, 0, 0.035]}>
              <planeGeometry args={[width + frameDef.gap! * 2 + 0.02, height + frameDef.gap! * 2 + 0.02]} />
              <meshStandardMaterial color={frameDef.mat!} roughness={0.9} />
            </mesh>
            <mesh position={[0, 0, 0.04]} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
              <planeGeometry args={[width, height]} />
              <meshStandardMaterial map={artTex} roughness={0.7} envMapIntensity={0.4} />
            </mesh>
          </>
        )}

        {/* 銘板(作品の右横) */}
        <mesh position={[halfW + 0.42, -height / 2 + 0.28, 0.02]}>
          <planeGeometry args={[0.42, 0.246]} />
          <meshStandardMaterial map={plaqueTex} roughness={0.9} />
        </mesh>

        {/* ピクチャーレールからの吊りワイヤー(美術館らしさのディテール) */}
        {!slot.noWire && [-1, 1].map((side) => {
          const topY = CEIL_H - 0.36 - 1.62 // レール位置(ローカル座標)
          const wireLen = topY - height / 2
          if (wireLen <= 0.05) return null
          return (
            <mesh key={side} position={[side * width * 0.3, height / 2 + wireLen / 2, 0.012]}>
              <cylinderGeometry args={[0.0045, 0.0045, wireLen, 6]} />
              <meshStandardMaterial color={0x2a2622} roughness={0.4} metalness={0.6} />
            </mesh>
          )
        })}
      </group>

      {/* スポットライト(額縁が壁に落とす影も焼き込む) */}
      <SpotWithTarget
        position={[lightPos.x, lightPos.y, lightPos.z]}
        targetPosition={[slot.x, 1.62, slot.z]}
        color={theme.spotColor}
        intensity={theme.spotIntensity}
        angle={0.46}
        penumbra={0.65}
        decay={1.1}
        castShadow
        shadowMapSize={LOW_POWER ? 512 : 1024}
      />

      {/* 照明器具(見た目だけ) */}
      <mesh position={[lightPos.x, CEIL_H - 0.11, lightPos.z]} quaternion={fixtureQuat}>
        <cylinderGeometry args={[0.055, 0.075, 0.22, 12]} />
        <meshStandardMaterial color={0x0c0b0a} roughness={0.5} />
      </mesh>
    </>
  )
}
