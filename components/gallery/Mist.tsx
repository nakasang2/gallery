'use client'
// 空間に漂う霧(ミスト): カメラに正対する柔らかいスプライトを空間に散らし、
// ゆっくり漂わせて空気感と遠近感を出す。ビルボードなのでどの角度からも霧に見え、
// スプライト数十枚だけなので非常に軽い
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CEIL_H, type LayoutDef, type ThemeDef } from '@/lib/presets'
import { disposeAll } from './textures'

// ふわっとした円形のアルファテクスチャ(霧のひとかたまり)
function makeMistTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  // 中心が濃く縁で消える柔らかい雲。少しムラを足して均一な円に見えないように
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 40; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.7
    const y = size / 2 + (Math.random() - 0.5) * size * 0.7
    const r = size * (0.06 + Math.random() * 0.14)
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r)
    rg.addColorStop(0, `rgba(255,255,255,${0.05 + Math.random() * 0.08})`)
    rg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = rg
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  return new THREE.CanvasTexture(c)
}

export default function Mist({ theme, layout }: { theme: ThemeDef; layout: LayoutDef }) {
  const group = useRef<THREE.Group>(null!)
  const level = theme.mistLevel ?? 0

  const tex = useMemo(() => makeMistTexture(), [])
  useEffect(() => () => disposeAll([tex]), [tex])

  // 霧のかたまりを空間に散らす。床近くに濃く、上へ薄く
  const puffs = useMemo(() => {
    if (level <= 0) return []
    const count = 34
    return Array.from({ length: count }, (_, i) => {
      // 高さは 0.2〜3.2m、低いほど出やすい(平方根で下に寄せる)
      const hf = Math.sqrt((i + 0.5) / count)
      return {
        x: (Math.random() - 0.5) * layout.hw * 2 * 0.95,
        y: 0.2 + hf * 3.0,
        z: (Math.random() - 0.5) * layout.hd * 2 * 0.95,
        size: 3.2 + Math.random() * 3.4,
        baseOpacity: level * (1 - hf * 0.55) * (0.6 + Math.random() * 0.6),
        driftX: (Math.random() - 0.5) * 0.18,
        driftZ: (Math.random() - 0.5) * 0.14,
        phase: Math.random() * Math.PI * 2,
        pulse: 0.15 + Math.random() * 0.2,
      }
    })
  }, [level, layout])

  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    const hw = layout.hw
    const hd = layout.hd
    group.current.children.forEach((obj, i) => {
      const P = puffs[i]
      if (!P) return
      const s = obj as THREE.Sprite
      // ゆっくり漂う(部屋の中でラップする)
      let x = P.x + t * P.driftX
      let z = P.z + t * P.driftZ
      x = ((((x + hw) % (hw * 2)) + hw * 2) % (hw * 2)) - hw
      z = ((((z + hd) % (hd * 2)) + hd * 2) % (hd * 2)) - hd
      s.position.set(x, P.y + Math.sin(t * 0.12 + P.phase) * 0.15, z)
      // スケールと濃さがゆっくり呼吸する(スプライトごとに材質を持つので個別制御できる)
      const pulse = 1 + Math.sin(t * 0.2 + P.phase) * P.pulse
      s.scale.set(P.size * pulse, P.size * pulse, 1)
      const mat = s.material as THREE.SpriteMaterial
      mat.opacity = P.baseOpacity * (0.7 + 0.3 * Math.sin(t * 0.18 + P.phase))
    })
  })

  if (level <= 0) return null

  return (
    <group ref={group}>
      {puffs.map((P, i) => (
        // material は共有、個別の濃さはスプライトごとの material クローンで持たせる
        <sprite key={i} position={[P.x, P.y, P.z]} scale={[P.size, P.size, 1]}>
          <spriteMaterial
            attach="material"
            map={tex}
            color={theme.mistColor ?? 0xcfcabf}
            transparent
            opacity={P.baseOpacity}
            depthWrite={false}
            blending={theme.mistAdditive ? THREE.AdditiveBlending : THREE.NormalBlending}
            fog
          />
        </sprite>
      ))}
    </group>
  )
}
