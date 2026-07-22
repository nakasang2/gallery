'use client'
// A single exhibit (frame + artwork + plaque + spotlight + light fixture)
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { ArtworkData } from '@/lib/artworks'
import { CEIL_H, type CaptionDef, type FrameDef, type HangingDef, type SlotDef, type ThemeDef } from '@/lib/presets'
import { artSize } from '@/lib/exhibition'
import { walkRef, LOW_POWER } from '@/lib/controller'
import { getArtTexture, makePlaqueTexture, getFrameFinish, disposeAll } from './textures'
import SpotWithTarget from './SpotWithTarget'
import LightCone from './LightCone'
import { useVideoArt } from './VideoArt'

// Beveled frame (extrude a hollowed-out border shape with a bevel)
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
  hangingDef,
  captionDef,
  lightMode,
}: {
  art: ArtworkData
  index: number
  slot: SlotDef
  theme: ThemeDef
  frameDef: FrameDef
  hangingDef: HangingDef
  captionDef: CaptionDef
  /** Spotlight placement: 'ceiling' track angled at the work, or 'overhead' straight down */
  lightMode: 'ceiling' | 'overhead'
}) {
  const gl = useThree((s) => s.gl)
  const { width, height } = artSize(art.ratio, art)

  // Video artworks: VideoTexture + spatial audio (image artworks are cached as before)
  const artWorldPos = useMemo(() => new THREE.Vector3(slot.x, 1.62, slot.z), [slot])
  const videoArt = useVideoArt(art, artWorldPos)
  const artTex = videoArt.texture ?? getArtTexture(art)

  const plaqueTex = useMemo(() => makePlaqueTexture(art, index), [art, index])
  useEffect(() => () => disposeAll([plaqueTex]), [plaqueTex])

  const frameless = frameDef.mat === null
  const frameGeo = useMemo(
    () => (frameless ? null : makeFrameGeo(width, height, frameDef.bar!, frameDef.gap!)),
    [frameless, width, height, frameDef]
  )
  useEffect(() => () => disposeAll([frameGeo]), [frameGeo])

  const halfW = frameless ? width / 2 : width / 2 + frameDef.gap! + frameDef.bar!
  const halfH = frameless ? height / 2 : height / 2 + frameDef.gap! + frameDef.bar!

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 10) return // it was a drag (matches WalkControls.TAP_THRESHOLD)
    walkRef.current?.focusExhibit(index)
  }
  const onOver = () => (gl.domElement.style.cursor = 'pointer')
  const onOut = () => (gl.domElement.style.cursor = '')

  const normal = useMemo(
    () => new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotY),
    [slot.rotY]
  )
  // Both modes light the work itself
  const spotTarget = artWorldPos
  // 'overhead' = a picture light mounted on the wall just above the frame, its arm reaching
  // this far into the room where the lamp head sits. 'ceiling' = a track light near the ceiling.
  const PICTURE_ARM = 0.34
  const lightPos = useMemo(() => {
    if (lightMode === 'overhead') {
      const p = new THREE.Vector3(slot.x, 0, slot.z).add(normal.clone().multiplyScalar(PICTURE_ARM))
      p.y = 1.62 + halfH + 0.22 // just above the top of the frame
      return p
    }
    const p = new THREE.Vector3(slot.x, 0, slot.z).add(normal.clone().multiplyScalar(2.1))
    p.y = CEIL_H - 0.15
    return p
  }, [slot, normal, lightMode, halfH])
  // The picture light sits close above the work, so it needs a wider cone to cover the frame
  const spotAngle = lightMode === 'overhead' ? 0.85 : 0.46
  const spotPenumbra = lightMode === 'overhead' ? 0.7 : 0.65
  const fixtureQuat = useMemo(() => {
    const dir = spotTarget.clone().sub(lightPos).normalize()
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
  }, [spotTarget, lightPos])

  return (
    <>
      <group position={[slot.x, 1.62, slot.z]} rotation-y={slot.rotY}>
        {frameless ? (
          // Stretched canvas: no frame, just showing the thickness on the sides
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
            <meshStandardMaterial
              attach="material-4"
              map={artTex}
              roughness={0.75}
              envMapIntensity={0.35}
              emissiveMap={videoArt.texture ? artTex : null}
              emissive={videoArt.texture ? 0xffffff : 0x000000}
              emissiveIntensity={videoArt.texture ? 0.7 : 0}
            />
            <meshStandardMaterial attach="material-5" color={0x1a1713} roughness={0.9} />
          </mesh>
        ) : (
          <>
            <mesh geometry={frameGeo!} position={[0, 0, 0.02]} castShadow>
              {/* Uniform sheen reads as plastic, so add subtle unevenness per finish */}
              <meshStandardMaterial
                color={frameDef.color}
                roughness={frameDef.roughness}
                metalness={frameDef.metalness}
                envMapIntensity={0.9}
                {...(frameDef.finish ? getFrameFinish(frameDef.finish) : {})}
                bumpScale={0.35}
              />
            </mesh>
            {/* Mat board (gap 0 = "no mat": the work sits right against the frame) */}
            {frameDef.gap! > 0 && (
              <mesh position={[0, 0, 0.035]}>
                <planeGeometry args={[width + frameDef.gap! * 2 + 0.02, height + frameDef.gap! * 2 + 0.02]} />
                <meshStandardMaterial color={frameDef.mat!} roughness={0.9} />
              </mesh>
            )}
            <mesh position={[0, 0, 0.04]} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
              <planeGeometry args={[width, height]} />
              <meshStandardMaterial
                map={artTex}
                roughness={0.7}
                envMapIntensity={0.4}
                emissiveMap={videoArt.texture ? artTex : null}
                emissive={videoArt.texture ? 0xffffff : 0x000000}
                emissiveIntensity={videoArt.texture ? 0.7 : 0}
              />
            </mesh>
          </>
        )}

        {/* Spatial audio for video artworks (louder as you get closer) */}
        {videoArt.audio && <primitive object={videoArt.audio} position={[0, 0, 0.1]} />}

        {/* Name plate — beside the work, below it, or hidden */}
        {captionDef.place !== 'none' && (
          <mesh
            position={
              captionDef.place === 'under'
                ? [0, -halfH - 0.2, 0.02]
                : [halfW + 0.42, -height / 2 + 0.28, 0.02]
            }
          >
            <planeGeometry args={[0.42, 0.246]} />
            <meshStandardMaterial map={plaqueTex} roughness={0.9} />
          </mesh>
        )}

        {/* Hanging hardware. wire = twin cords to the picture rail; ledge = a shelf
            the work rests on; flush = nothing. Center walls have no rail, so wire
            falls back to no hardware there (slot.noWire). */}
        {hangingDef.kind === 'wire' &&
          !slot.noWire &&
          [-1, 1].map((side) => {
            const topY = CEIL_H - 0.36 - 1.62 // rail position (local coordinates)
            const wireLen = topY - height / 2
            if (wireLen <= 0.05) return null
            return (
              <mesh key={side} position={[side * width * 0.3, height / 2 + wireLen / 2, 0.012]}>
                <cylinderGeometry args={[0.0045, 0.0045, wireLen, 6]} />
                <meshStandardMaterial color={0x2a2622} roughness={0.4} metalness={0.6} />
              </mesh>
            )
          })}
        {hangingDef.kind === 'ledge' && (
          <mesh position={[0, -halfH - 0.02, 0.1]} castShadow>
            <boxGeometry args={[halfW * 2 + 0.12, 0.035, 0.16]} />
            <meshStandardMaterial color={0x1c1916} roughness={0.5} metalness={0.3} />
          </mesh>
        )}
      </group>

      {/* Spotlight (also bakes the shadow the frame casts on the wall) */}
      <SpotWithTarget
        position={[lightPos.x, lightPos.y, lightPos.z]}
        targetPosition={[spotTarget.x, spotTarget.y, spotTarget.z]}
        color={theme.spotColor}
        intensity={theme.spotIntensity}
        angle={spotAngle}
        penumbra={spotPenumbra}
        decay={1.1}
        castShadow
        shadowMapSize={LOW_POWER ? 512 : 1024}
      />

      {/* Light shaft (fake volumetric) */}
      <LightCone
        from={lightPos}
        to={spotTarget}
        angle={spotAngle}
        color={theme.spotColor}
        opacity={theme.coneOpacity}
      />

      {/* Light fixture (visual only) */}
      {lightMode === 'overhead' ? (
        // Picture light: a bracket on the wall above the frame, arm reaching out to a
        // horizontal shade tilted down at the work
        <group position={[slot.x, 1.62 + halfH + 0.22, slot.z]} rotation-y={slot.rotY}>
          <mesh position={[0, 0, PICTURE_ARM / 2]}>
            <boxGeometry args={[0.05, 0.05, PICTURE_ARM]} />
            <meshStandardMaterial color={0x14110d} roughness={0.5} metalness={0.45} />
          </mesh>
          <group position={[0, -0.02, PICTURE_ARM]} rotation-x={0.7}>
            <mesh rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.05, 0.06, Math.min(halfW * 2, 1.3), 16]} />
              <meshStandardMaterial color={0x1c1915} roughness={0.4} metalness={0.55} />
            </mesh>
          </group>
        </group>
      ) : (
        <mesh position={[lightPos.x, CEIL_H - 0.11, lightPos.z]} quaternion={fixtureQuat}>
          <cylinderGeometry args={[0.055, 0.075, 0.22, 12]} />
          <meshStandardMaterial color={0x0c0b0a} roughness={0.5} />
        </mesh>
      )}
    </>
  )
}
