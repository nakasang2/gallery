'use client'
// Full-screen "handle it in your hands" preview: the focused work, framed exactly
// like the room hangs it, floating on a neutral studio backdrop. Drag to orbit,
// wheel/pinch to zoom. This is a SEPARATE on-demand canvas from the gallery — a
// preview space, not the gallery room (decision 2026-07-24).
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { getArtTexture, getCanvasWeave, getFrameFinish, getNeutralEnvTexture, disposeAll } from './textures'
import { exhibitExtents, makeFrameGeo } from './Exhibit'
import type { ArtworkData } from '@/lib/artworks'
import type { FrameDef, ThemeDef } from '@/lib/presets'

// Faint symmetric environment (metal frame catches it) — same source the room uses,
// so gold/steel frames read the way they do on the wall.
function Env() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const envTex = pmrem.fromEquirectangular(getNeutralEnvTexture()).texture
    scene.environment = envTex
    scene.environmentIntensity = 1.0
    pmrem.dispose()
    return () => {
      scene.environment = null
      envTex.dispose()
    }
  }, [gl, scene])
  return null
}

// The framed work as a free-floating object, centred on the origin so orbiting
// pivots around the artwork itself. Geometry/offsets mirror Exhibit's wall hang.
function FramedWork({ art, frameDef }: { art: ArtworkData; frameDef: FrameDef }) {
  const { width, height, frameless } = exhibitExtents(art, frameDef)

  // Video works have no still image texture (the wall uses a VideoTexture); show
  // their poster here. Everything else uses the same texture the wall does.
  const artTex = useMemo(() => {
    if (art.kind === 'video' && art.poster) {
      const t = new THREE.TextureLoader().load(art.poster)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 16
      return t
    }
    return getArtTexture(art)
  }, [art])

  const weaveTex = useMemo(() => {
    if (art.kind === 'video') return null
    const t = getCanvasWeave().clone()
    t.repeat.set(width / 0.12, height / 0.12)
    return t
  }, [art.kind, width, height])
  useEffect(() => () => disposeAll([weaveTex]), [weaveTex])

  const frameGeo = useMemo(
    () => (frameless ? null : makeFrameGeo(width, height, frameDef.bar!, frameDef.gap!)),
    [frameless, width, height, frameDef]
  )
  useEffect(() => () => disposeAll([frameGeo]), [frameGeo])

  // Pull the stack back along Z so the visual centre (the art plane at ~0.09) sits
  // on the origin — the orbit target.
  return (
    <group position={[0, 0, -0.09]}>
      {frameless ? (
        <mesh position={[0, 0, 0.063]}>
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
          />
          <meshStandardMaterial attach="material-5" color={0x1a1713} roughness={0.9} />
        </mesh>
      ) : (
        <>
          <mesh geometry={frameGeo!} position={[0, 0, 0.055]}>
            <meshStandardMaterial
              color={frameDef.color}
              roughness={frameDef.roughness}
              metalness={frameDef.metalness}
              envMapIntensity={0.9}
              {...(frameDef.finish ? getFrameFinish(frameDef.finish) : {})}
              bumpScale={0.35}
            />
          </mesh>
          {frameDef.gap! > 0 && (
            <mesh position={[0, 0, 0.11]}>
              <planeGeometry args={[width + frameDef.gap! * 2 + 0.02, height + frameDef.gap! * 2 + 0.02]} />
              <meshStandardMaterial color={frameDef.mat!} roughness={0.9} />
            </mesh>
          )}
          <mesh position={[0, 0, 0.115]}>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial
              map={artTex}
              roughness={0.7}
              envMapIntensity={0.4}
              bumpMap={weaveTex}
              bumpScale={0.35}
            />
          </mesh>
        </>
      )}
    </group>
  )
}

// Opening "grab": glide in from a pulled-back, slightly off-axis pose to the
// straight-on fit, easing out. Runs BEFORE OrbitControls mounts so nothing fights
// it for the camera; calls onDone at the end, which hands control to the orbiter.
function IntroDolly({
  start,
  end,
  onDone,
}: {
  start: THREE.Vector3
  end: THREE.Vector3
  onDone: () => void
}) {
  const camera = useThree((s) => s.camera)
  const t = useRef(0)
  const DURATION = 1.15
  useEffect(() => {
    camera.position.copy(start)
    camera.lookAt(0, 0, 0)
  }, [camera, start])
  useFrame((_, dt) => {
    if (t.current >= 1) return
    t.current = Math.min(1, t.current + dt / DURATION)
    const e = 1 - Math.pow(1 - t.current, 3) // easeOutCubic
    camera.position.lerpVectors(start, end, e)
    camera.lookAt(0, 0, 0)
    if (t.current >= 1) onDone()
  })
  return null
}

export default function ArtworkPreview3D({
  art,
  frameDef,
  theme,
  onClose,
}: {
  art: ArtworkData
  frameDef: FrameDef
  theme: ThemeDef
  onClose: () => void
}) {
  const { width, height } = exhibitExtents(art, frameDef)
  const maxDim = Math.max(width, height)
  // Frame the object with a little air; zoom range keeps it from clipping or flying off.
  const fitDist = maxDim / (2 * Math.tan((40 * Math.PI) / 360)) + maxDim * 0.35

  // Intro dolly poses: a pulled-back, slightly high + off-axis start easing into
  // the straight-on fit. Respect reduced-motion by starting already settled.
  const reduce = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  )
  const end = useMemo(() => new THREE.Vector3(0, 0, fitDist), [fitDist])
  const start = useMemo(() => {
    const d = fitDist * 1.9
    const az = 0.32 // radians off to the side
    const el = 0.14 // radians above
    return new THREE.Vector3(
      d * Math.cos(el) * Math.sin(az),
      d * Math.sin(el),
      d * Math.cos(el) * Math.cos(az)
    )
  }, [fitDist])
  const [intro, setIntro] = useState(!reduce)

  // Esc closes, and the body must not scroll behind the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const initialPos = intro ? start : end
  return (
    <div className="artpreview" role="dialog" aria-modal="true" aria-label={`${art.title} — 3D preview`}>
      <Canvas
        camera={{ position: [initialPos.x, initialPos.y, initialPos.z], fov: 40 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={[new THREE.Color(theme.fog).multiplyScalar(0.5).getHex()]} />
        <Env />
        <ambientLight intensity={0.55} />
        {/* A warm key from upper-left and a cool fill so rotation reveals form */}
        <directionalLight position={[-2.5, 3, 3.5]} intensity={1.6} color={theme.spotColor} />
        <directionalLight position={[3, -1, 2]} intensity={0.4} color={0xbfd0e0} />
        <Suspense fallback={null}>
          <FramedWork art={art} frameDef={frameDef} />
        </Suspense>
        {intro ? (
          <IntroDolly start={start} end={end} onDone={() => setIntro(false)} />
        ) : (
          // Mounted only after the dolly finishes, so it inherits the settled pose
          // cleanly instead of fighting the animation for the camera.
          <OrbitControls
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            rotateSpeed={0.8}
            minDistance={maxDim * 0.6}
            maxDistance={fitDist * 2.2}
            target={[0, 0, 0]}
          />
        )}
      </Canvas>
      <button className="artpreview-close" aria-label="Close preview" onClick={onClose}>
        ×
      </button>
      <div className="artpreview-hint">Drag to rotate · scroll or pinch to zoom</div>
    </div>
  )
}
