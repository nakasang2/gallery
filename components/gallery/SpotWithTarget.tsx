'use client'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

// three の SpotLight は target が Object3D 参照なので、宣言的に扱うための小さなラッパー
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
        shadow-camera-near={0.5}
      />
      <primitive object={target} position={targetPosition} />
    </>
  )
}
