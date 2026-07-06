'use client'
// 漂う塵(空気感)
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CEIL_H, type LayoutDef } from '@/lib/presets'
import { disposeAll } from './textures'

export default function Dust({ layout }: { layout: LayoutDef }) {
  const points = useRef<THREE.Points>(null!)

  const geo = useMemo(() => {
    const N = 260
    const positions = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      positions[i * 3] = (Math.random() - 0.5) * layout.hw * 2
      positions[i * 3 + 1] = Math.random() * CEIL_H
      positions[i * 3 + 2] = (Math.random() - 0.5) * layout.hd * 2
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [layout])

  const tex = useMemo(() => {
    // 丸くぼかしたスプライト(四角いピクセルにならないように)
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')!
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,242,216,1)')
    grad.addColorStop(0.4, 'rgba(255,242,216,0.5)')
    grad.addColorStop(1, 'rgba(255,242,216,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 64)
    return new THREE.CanvasTexture(c)
  }, [])

  useEffect(() => () => disposeAll([geo, tex]), [geo, tex])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const pos = points.current.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.06
      if (y > CEIL_H) y = 0
      pos.setY(i, y)
    }
    pos.needsUpdate = true
  })

  return (
    <points ref={points} geometry={geo}>
      <pointsMaterial
        map={tex}
        size={0.04}
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}
