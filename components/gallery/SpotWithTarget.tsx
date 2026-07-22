'use client'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

// three's SpotLight uses an Object3D reference for its target, so this is a small wrapper to handle it declaratively
export default function SpotWithTarget({
  position,
  targetPosition,
  color,
  intensity,
  angle,
  penumbra,
  decay,
  castShadow = false,
  shadowMapSize = 1024,
  shadowRadius = 4,
}: {
  position: [number, number, number]
  targetPosition: [number, number, number]
  color: number
  intensity: number
  angle: number
  penumbra: number
  decay: number
  castShadow?: boolean
  shadowMapSize?: number
  shadowRadius?: number
}) {
  const light = useRef<THREE.SpotLight>(null!)
  const target = useMemo(() => new THREE.Object3D(), [])

  useEffect(() => {
    light.current.target = target
  }, [target])

  return (
    <>
      <spotLight
        ref={light}
        position={position}
        color={color}
        intensity={intensity}
        angle={angle}
        penumbra={penumbra}
        decay={decay}
        castShadow={castShadow}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-bias={-0.0003}
        shadow-radius={shadowRadius}
        shadow-camera-near={0.5}
      />
      <primitive object={target} position={targetPosition} />
    </>
  )
}
