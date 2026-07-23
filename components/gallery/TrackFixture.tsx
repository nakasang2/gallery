'use client'
// Ceiling track spotlight fixture (visual only): canopy + stem + angled barrel with
// a glowing aperture. Shared by every ceiling-mounted spot (exhibits, title wall)
// so the "where is this light coming from" answer always looks the same.
import { useMemo } from 'react'
import * as THREE from 'three'
import { CEIL_H } from '@/lib/presets'

const BODY = { color: 0x111010, roughness: 0.42, metalness: 0.55 }

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
