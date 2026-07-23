'use client'
// A single exhibit (frame + artwork + plaque + spotlight + light fixture)
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { ArtworkData } from '@/lib/artworks'
import { CEIL_H, type CaptionDef, type FrameDef, type HangingDef, type SlotDef, type ThemeDef } from '@/lib/presets'
import { artSize } from '@/lib/exhibition'
import { walkRef, QUALITY } from '@/lib/controller'
import { getArtTexture, makePlaqueTexture, getFrameFinish, getSoftShadowTexture, getCanvasWeave, disposeAll } from './textures'
import SpotWithTarget from './SpotWithTarget'
import LightCone from './LightCone'
import TrackFixture from './TrackFixture'
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
    // Deeper profile so the frame stands off the wall and casts a longer, more
    // visible shadow (the mat/art planes below sit near the front of this depth).
    depth: 0.085,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.014,
    bevelSegments: 5, // rounder shoulder — the highlight sweeps instead of stepping
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

  // Linen-weave bump on the paint surface (image works only — video stays glossy).
  // Repeat is tied to the work's real size so the thread pitch is constant.
  const weaveTex = useMemo(() => {
    if (videoArt.texture) return null
    const t = getCanvasWeave().clone()
    t.repeat.set(width / 0.12, height / 0.12)
    return t
  }, [videoArt.texture, width, height])
  useEffect(() => () => disposeAll([weaveTex]), [weaveTex])

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

  return (
    <>
      <group position={[slot.x, 1.62, slot.z]} rotation-y={slot.rotY}>
        {/* Art-directed soft drop shadow on the wall — reads as the piece standing off
            the wall. Sits just off the wall (behind the frame), a bit larger than the
            work and shifted down, since the light comes from above. Independent of the
            per-work light mode, so it's reliable where the real shadow map is too faint. */}
        <mesh position={[0.05, -0.24, 0.006]}>
          <planeGeometry args={[halfW * 2 + 0.6, halfH * 2 + 0.85]} />
          <meshBasicMaterial
            map={getSoftShadowTexture()}
            transparent
            opacity={0.5}
            color={0x000000}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
        {/* Second, tighter core just past the frame edge — the two layers together
            approximate contact hardening (sharp near the frame, soft further out) */}
        <mesh position={[0.025, -0.11, 0.007]}>
          <planeGeometry args={[halfW * 2 + 0.22, halfH * 2 + 0.34]} />
          <meshBasicMaterial
            map={getSoftShadowTexture()}
            transparent
            opacity={0.45}
            color={0x000000}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
        {frameless ? (
          // Stretched canvas: no frame, just showing the thickness on the sides
          <mesh
            position={[0, 0, 0.063]}
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
              bumpMap={weaveTex}
              bumpScale={0.35}
              emissiveMap={videoArt.texture ? artTex : null}
              emissive={videoArt.texture ? 0xffffff : 0x000000}
              emissiveIntensity={videoArt.texture ? 0.7 : 0}
            />
            <meshStandardMaterial attach="material-5" color={0x1a1713} roughness={0.9} />
          </mesh>
        ) : (
          <>
            {/* The whole stack floats ~3.5cm off the wall (gallery standoff mount):
                the gap makes the drop shadow read as real depth, and the spot now
                throws a visible cast shadow below the frame */}
            <mesh geometry={frameGeo!} position={[0, 0, 0.055]} castShadow>
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
            {/* Mat board (gap 0 = "no mat": the work sits right against the frame).
                castShadow so the framed piece casts a FILLED shadow, not just the
                frame's hollow outline (the mat fills the opening; art fills it when
                there's no mat). */}
            {frameDef.gap! > 0 && (
              <mesh position={[0, 0, 0.11]} castShadow>
                <planeGeometry args={[width + frameDef.gap! * 2 + 0.02, height + frameDef.gap! * 2 + 0.02]} />
                <meshStandardMaterial color={frameDef.mat!} roughness={0.9} />
              </mesh>
            )}
            <mesh position={[0, 0, 0.115]} castShadow onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
              <planeGeometry args={[width, height]} />
              <meshStandardMaterial
                map={artTex}
                roughness={0.7}
                envMapIntensity={0.4}
                bumpMap={weaveTex}
                bumpScale={0.35}
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
          // Physical standoff plaque: a thin board floating off the wall with its
          // own soft shadow, instead of a flat decal (which read as printed-on)
          <group
            position={
              captionDef.place === 'under'
                ? [0, -halfH - 0.2, 0.042]
                : [halfW + 0.42, -height / 2 + 0.28, 0.042]
            }
          >
            <mesh position={[0.01, -0.035, -0.035]}>
              <planeGeometry args={[0.54, 0.37]} />
              <meshBasicMaterial
                map={getSoftShadowTexture()}
                transparent
                opacity={0.4}
                color={0x000000}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-1}
              />
            </mesh>
            <mesh castShadow>
              <boxGeometry args={[0.42, 0.246, 0.014]} />
              <meshStandardMaterial attach="material-0" color={0xd8d3c7} roughness={0.85} />
              <meshStandardMaterial attach="material-1" color={0xd8d3c7} roughness={0.85} />
              <meshStandardMaterial attach="material-2" color={0xe4dfd4} roughness={0.85} />
              <meshStandardMaterial attach="material-3" color={0xc9c4b8} roughness={0.85} />
              <meshStandardMaterial attach="material-4" map={plaqueTex} roughness={0.82} />
              <meshStandardMaterial attach="material-5" color={0xd8d3c7} roughness={0.85} />
            </mesh>
          </group>
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
              <mesh key={side} position={[side * width * 0.3, height / 2 + wireLen / 2, 0.03]}>
                <cylinderGeometry args={[0.0045, 0.0045, wireLen, 6]} />
                <meshStandardMaterial color={0x2a2622} roughness={0.4} metalness={0.6} />
              </mesh>
            )
          })}
        {hangingDef.kind === 'ledge' && (
          <mesh position={[0, -halfH - 0.02, 0.135]} castShadow>
            <boxGeometry args={[halfW * 2 + 0.12, 0.035, 0.16]} />
            <meshStandardMaterial color={0x1c1916} roughness={0.5} metalness={0.3} />
          </mesh>
        )}
      </group>

      {/* Spotlight (also bakes the shadow the frame casts on the wall).
          decay 2 = physical inverse-square falloff: the pool of light is bright at
          its centre and dies off quickly, like a real gallery spot. The per-mode
          factor rebalances theme.spotIntensity for each mounting distance
          (ceiling track ~2.9m vs picture light ~0.5m) so overall exposure holds. */}
      <SpotWithTarget
        position={[lightPos.x, lightPos.y, lightPos.z]}
        targetPosition={[spotTarget.x, spotTarget.y, spotTarget.z]}
        color={theme.spotColor}
        intensity={theme.spotIntensity * (lightMode === 'overhead' ? 0.62 : 2.6)}
        angle={spotAngle}
        penumbra={spotPenumbra}
        decay={2}
        castShadow
        shadowMapSize={QUALITY === 'high' ? 2048 : 1024}
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
        // Brass gallery picture light: a backplate on the wall, an arm reaching out, and a
        // tubular shade (with rounded end caps + a glowing bulb) tilted down at the work
        (() => {
          const brass = { color: 0x9a7b40, metalness: 0.92, roughness: 0.3 }
          const hoodLen = Math.min(halfW * 2 + 0.12, 1.45)
          return (
            <group position={[slot.x, 1.62 + halfH + 0.24, slot.z]} rotation-y={slot.rotY}>
              {/* wall backplate */}
              <mesh position={[0, 0.02, 0.016]}>
                <boxGeometry args={[0.11, 0.11, 0.03]} />
                <meshStandardMaterial {...brass} />
              </mesh>
              {/* arm — a slim rod angling out and slightly up to the shade */}
              <mesh position={[0, 0.035, PICTURE_ARM * 0.5]} rotation-x={Math.PI / 2 + 0.22}>
                <cylinderGeometry args={[0.013, 0.013, PICTURE_ARM * 1.08, 12]} />
                <meshStandardMaterial {...brass} />
              </mesh>
              {/* shade: a tube across the frame width, tilted to throw light down the work */}
              <group position={[0, 0.02, PICTURE_ARM]} rotation-x={0.55}>
                <mesh rotation-z={Math.PI / 2}>
                  <cylinderGeometry args={[0.045, 0.045, hoodLen, 24]} />
                  <meshStandardMaterial {...brass} roughness={0.26} />
                </mesh>
                {[-1, 1].map((s) => (
                  <mesh key={s} position={[(s * hoodLen) / 2, 0, 0]}>
                    <sphereGeometry args={[0.046, 16, 12]} />
                    <meshStandardMaterial {...brass} roughness={0.26} />
                  </mesh>
                ))}
                {/* glowing bulb strip on the underside, facing the work */}
                <mesh position={[0, -0.03, 0.02]} rotation-z={Math.PI / 2}>
                  <cylinderGeometry args={[0.02, 0.02, hoodLen * 0.9, 12]} />
                  <meshStandardMaterial
                    color={theme.spotColor}
                    emissive={theme.spotColor}
                    emissiveIntensity={1.7}
                    toneMapped={false}
                  />
                </mesh>
              </group>
            </group>
          )
        })()
      ) : (
        <TrackFixture at={lightPos} target={spotTarget} color={theme.spotColor} />
      )}
    </>
  )
}
