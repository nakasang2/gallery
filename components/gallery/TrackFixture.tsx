'use client'
// Ceiling track spotlight fixture (visual only): canopy + stem + angled barrel with
// a glowing aperture. Shared by every ceiling-mounted spot (exhibits, title wall)
// so the "where is this light coming from" answer always looks the same.
import { useMemo } from 'react'
import * as THREE from 'three'
import { CEIL_H } from '@/lib/presets'

const BODY = { color: 0x111010, roughness: 0.42, metalness: 0.55 }

/** World position of the fixture's glowing aperture — where the visible light
 *  shaft must START. The barrel pivots at (at.x, CEIL_H−0.1, at.z) and its mouth
 *  sits 0.21 along the beam; a cone drawn from the light's own position instead
 *  appears to leak out of the fixture's neck (user-reported). */
export function fixtureAperture(at: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  const pivot = new THREE.Vector3(at.x, CEIL_H - 0.1, at.z)
  const dir = target.clone().sub(at).normalize()
  return pivot.addScaledVector(dir, 0.21)
}

export default function TrackFixture({
  at,
  target,
  color,
}: {
  /** The spotlight's position — the canopy mounts to the ceiling directly above */
  at: THREE.Vector3
  /** What the lamp is aimed at */
  target: THREE.Vector3
  color: number
}) {
  // Barrel pivots at the stem tip; -Y (the mouth) swings onto the beam direction
  const quat = useMemo(() => {
    const dir = target.clone().sub(at).normalize()
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
  }, [at, target])

  return (
    <group position={[at.x, CEIL_H, at.z]}>
      {/* ceiling canopy */}
      <mesh position={[0, -0.014, 0]}>
        <cylinderGeometry args={[0.056, 0.056, 0.028, 16]} />
        <meshStandardMaterial {...BODY} />
      </mesh>
      {/* stem */}
      <mesh position={[0, -0.055, 0]}>
        <cylinderGeometry args={[0.011, 0.011, 0.06, 10]} />
        <meshStandardMaterial {...BODY} />
      </mesh>
      {/* barrel assembly angled at the target */}
      <group position={[0, -0.1, 0]} quaternion={quat}>
        {/* barrel (slightly flared toward the mouth) */}
        <mesh position={[0, -0.095, 0]}>
          <cylinderGeometry args={[0.045, 0.052, 0.19, 20]} />
          <meshStandardMaterial {...BODY} />
        </mesh>
        {/* front trim ring */}
        <mesh position={[0, -0.196, 0]}>
          <cylinderGeometry args={[0.056, 0.056, 0.02, 20]} />
          <meshStandardMaterial color={0x1b1917} roughness={0.3} metalness={0.7} />
        </mesh>
        {/* glowing aperture — sells the fixture as the source of the light pool */}
        <mesh position={[0, -0.2075, 0]} rotation-x={Math.PI / 2}>
          <circleGeometry args={[0.04, 20]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={2.4}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  )
}
