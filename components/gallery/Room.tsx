'use client'
// Room (floor, ceiling, walls, baseboards, crown molding, central walls, light strips, benches, overall lighting)
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import { CEIL_H, type LayoutDef, type ThemeDef } from '@/lib/presets'
import { walkRef, LOW_POWER, QUALITY } from '@/lib/controller'
import { getFloorTextures, getPlasterBump, getPlasterNormal, getConcreteMaps, getBlobShadowTexture, disposeAll } from './textures'
import SpotWithTarget from './SpotWithTarget'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

// One-time initialization needed to use RectAreaLight (skylight)
let rectAreaInited = false
if (typeof window !== 'undefined' && !rectAreaInited) {
  RectAreaLightUniformsLib.init()
  rectAreaInited = true
}

const TRIM_COLOR = 0x0e0c0a

// Wall surface maps, tiled to real-world scale (one tile = 3.2m). Plaster =
// normal + roughness only; concrete adds a tinted color map (seams/tie holes/
// stains) and a stronger relief.
type WallFinish = 'plaster' | 'concrete'
function useWallMaps(widthM: number, finish: WallFinish) {
  const maps = useMemo(() => {
    const rep: [number, number] = [widthM / 3.2, CEIL_H / 3.2]
    if (finish === 'concrete') {
      const base = getConcreteMaps()
      const map = base.map.clone()
      const normalMap = base.normalMap.clone()
      const roughnessMap = base.roughnessMap.clone()
      for (const t of [map, normalMap, roughnessMap]) t.repeat.set(...rep)
      return { map, normalMap, roughnessMap, normalScale: 1.0 }
    }
    const normalMap = getPlasterNormal().clone()
    normalMap.repeat.set(...rep)
    const roughnessMap = getPlasterBump().clone()
    roughnessMap.repeat.set(...rep)
    return { map: null, normalMap, roughnessMap, normalScale: 0.6 }
  }, [widthM, finish])
  useEffect(() => () => disposeAll([maps.map, maps.normalMap, maps.roughnessMap]), [maps])
  return maps
}

function Wall({
  width,
  color,
  finish,
  position,
  rotationY,
}: {
  width: number
  color: number
  finish: WallFinish
  position: [number, number, number]
  rotationY: number
}) {
  const { map, normalMap, roughnessMap, normalScale } = useWallMaps(width, finish)
  return (
    <mesh position={position} rotation-y={rotationY} receiveShadow>
      <planeGeometry args={[width, CEIL_H]} />
      {/* The normal map catches grazing light and the roughness map gives uneven sheen */}
      <meshStandardMaterial
        color={color}
        map={map}
        roughness={0.93}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(normalScale, normalScale)}
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
  // The seat reuses the same floor wood-grain texture in a darker tint
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
      {/* Low tier renders no real shadows, so fake the bench's contact shadow with
          the shared blurred-blob texture (same trick as the wall drop shadows) */}
      {QUALITY === 'low' && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
          <planeGeometry args={[2.5, 0.95]} />
          {/* radially uniform blob — the wall-shadow texture has a vertical
              gradient that would point along +Z when laid flat */}
          <meshBasicMaterial
            map={getBlobShadowTexture()}
            transparent
            opacity={0.34}
            color={0x000000}
            depthWrite={false}
          />
        </mesh>
      )}
      {/* Downlight directly above the bench (casts a contact shadow). Kept to a
          tight cone — a wide one paints a huge unexplained bright patch across
          the floor in dark themes */}
      <SpotWithTarget
        position={[0, CEIL_H - 0.1, 0]}
        targetPosition={[0, 0, 0]}
        color={theme.spotColor}
        intensity={22}
        angle={0.62}
        penumbra={0.9}
        decay={2}
        castShadow
      />
    </group>
  )
}

export default function Room({ theme, layout }: { theme: ThemeDef; layout: LayoutDef }) {
  const { hw, hd } = layout
  const h = CEIL_H

  // Floor: keep the plank grain at real scale (about 5.3m x 2.7m per tile)
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

  const finish: WallFinish = theme.wallFinish ?? 'plaster'
  const partitionMaps = useWallMaps(8, finish)
  // The ceiling reuses the plaster normal map: dead-flat white overhead is a big
  // CG tell once the emissive strips and skylight graze it
  const ceilingNormal = useMemo(() => {
    const t = getPlasterNormal().clone()
    t.repeat.set((hw * 2) / 3.2, (hd * 2) / 3.2)
    return t
  }, [hw, hd])
  useEffect(() => () => disposeAll([ceilingNormal]), [ceilingNormal])

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 10) return // it was a drag (matches WalkControls.TAP_THRESHOLD)
    walkRef.current?.walkTo(e.point)
  }

  // Number of ceiling indirect-light strips (based on room depth)
  const stripZs = useMemo(() => {
    const n = Math.max(1, Math.floor(hd / 2.5))
    return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 4)
  }, [hd])

  return (
    <group>
      {/* Floor */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow onClick={onFloorClick}>
        <planeGeometry args={[hw * 2, hd * 2]} />
        {LOW_POWER ? (
          // Mobile/low-power: the real-time reflection pass is too costly, so keep the
          // cheap clearcoat sheen.
          <meshPhysicalMaterial
            {...floorTex}
            color={theme.floorTint}
            bumpScale={0.5}
            roughness={0.9}
            clearcoat={0.25}
            clearcoatRoughness={0.55}
            envMapIntensity={0.6}
          />
        ) : (
          // Desktop: a polished floor that softly reflects the works and room (planar
          // reflection). Blurred + roughness kept high so it reads as waxed wood, not a
          // mirror; the wood grain stays via map/roughnessMap/bumpMap.
          // Deliberately NO depthScale: the depth-fade branch samples a 16-bit depth
          // texture and is the reflector's only GPU-dependent path — on some machines
          // it blows out into white patches exactly where the mirrored ray travels far
          // (the artless stretches of wall; user-reported, not reproducible here).
          <MeshReflectorMaterial
            map={floorTex.map}
            roughnessMap={floorTex.roughnessMap}
            bumpMap={floorTex.bumpMap}
            bumpScale={0.5}
            color={theme.floorTint}
            resolution={1024} // 512 sparkles/crawls when the camera moves
            blur={[360, 100]}
            mixBlur={1}
            // Raised back up (user request) now that the real white-wash culprits
            // are gone (floor specular killed via roughness/metalness, symmetric
            // env map, no depth-fade branch, bloom threshold 1.0) — the artworks
            // and room should visibly mirror in the polished floor.
            mixStrength={0.5}
            mixContrast={1}
            mirror={0.38}
            // roughness high + metalness 0: the spotlights otherwise paint a huge
            // view-dependent specular hotspot on the floor when you face a wall
            // head-on (eye/light/floor angles align) — the "white patch" that only
            // shows from straight-on viewpoints. The planar reflection (mixStrength/
            // mirror above) is unaffected; only the direct light specular dims.
            roughness={0.93}
            metalness={0}
            envMapIntensity={0.5}
          />
        )}
      </mesh>

      {/* Ceiling */}
      <mesh rotation-x={Math.PI / 2} position={[0, h, 0]}>
        <planeGeometry args={[hw * 2, hd * 2]} />
        <meshStandardMaterial
          color={theme.ceiling}
          roughness={0.95}
          normalMap={ceilingNormal}
          normalScale={new THREE.Vector2(0.35, 0.35)}
        />
      </mesh>

      {/* Walls (the west face uses the accent color for the title wall) */}
      <Wall width={hw * 2} color={theme.wall} finish={finish} position={[0, h / 2, -hd]} rotationY={0} />
      <Wall width={hw * 2} color={theme.wall} finish={finish} position={[0, h / 2, hd]} rotationY={Math.PI} />
      <Wall width={hd * 2} color={theme.wall} finish={finish} position={[hw, h / 2, 0]} rotationY={-Math.PI / 2} />
      <Wall width={hd * 2} color={theme.accentWall} finish={finish} position={[-hw, h / 2, 0]} rotationY={Math.PI / 2} />

      {/* Baseboards and crown molding */}
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

      {/* Central free-standing walls (depending on layout) */}
      {layout.partitions.map((p, i) => (
        <group key={i}>
          <mesh position={[p.x, p.h / 2, p.z]} castShadow receiveShadow>
            <boxGeometry args={[p.w, p.h, p.t]} />
            <meshStandardMaterial
              color={theme.accentWall}
              map={partitionMaps.map}
              roughness={0.95}
              normalMap={partitionMaps.normalMap}
              normalScale={new THREE.Vector2(partitionMaps.normalScale, partitionMaps.normalScale)}
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

      {/* Ceiling indirect-light strips (emissive in HDR so they pick up bloom) */}
      {stripZs.map((z) => (
        <mesh key={z} position={[0, h - 0.02, z]}>
          <boxGeometry args={[hw * 1.6, 0.02, 0.09]} />
          <meshStandardMaterial color={0x000000} emissive={theme.stripColor} emissiveIntensity={2.4} />
        </mesh>
      ))}

      {/* Picture rail (thin rail that holds the frame hanging wires) */}
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

      {/* Skylight (white cube): a soft natural-light area light */}
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

      {/* Benches */}
      {layout.benches.map((b) => (
        <Bench key={`${b.x},${b.z}`} x={b.x} z={b.z} theme={theme} />
      ))}

      {/* Keep ambient light low to bring out shadow and spotlight contrast */}
      <ambientLight color={0xfff4e0} intensity={theme.ambient} />
      <hemisphereLight color={0xfff8ea} groundColor={0x4a4136} intensity={theme.hemi} />
    </group>
  )
}
