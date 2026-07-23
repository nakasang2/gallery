'use client'
// Drifting dust (atmosphere)
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CEIL_H, type LayoutDef } from '@/lib/presets'
import { disposeAll } from './textures'

export default function Dust({ layout }: { layout: LayoutDef }) {
  const points = useRef<THREE.Points>(null!)

  const geo = useMemo(() => {
    const N = 380 // finer grains, slightly denser so the air still reads as alive
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
    // Soft round sprite (so it doesn't render as square pixels)
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

  // Perspective attenuation makes a mote that drifts right past the camera balloon
  // into a big white orb (reads as a glowing artifact on dark walls) — clamp the
  // on-screen point size. fog_vertex is the last chunk after gl_PointSize is set.
  const mat = useMemo(() => {
    const m = new THREE.PointsMaterial({
      map: tex,
      size: 0.02,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\n\tgl_PointSize = min(gl_PointSize, 9.0);'
      )
    }
    return m
  }, [tex])

  useEffect(() => () => disposeAll([geo, tex, mat]), [geo, tex, mat])

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

  return <points ref={points} geometry={geo} material={mat} />
}
