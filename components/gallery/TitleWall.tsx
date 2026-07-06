'use client'
// タイトルウォール(西面のアクセント壁に展覧会名を表示)
import { useEffect, useMemo } from 'react'
import { CEIL_H, type LayoutDef, type ThemeDef } from '@/lib/presets'
import { makeTitleTexture, disposeAll } from './textures'
import SpotWithTarget from './SpotWithTarget'

export default function TitleWall({ theme, layout }: { theme: ThemeDef; layout: LayoutDef }) {
  const tex = useMemo(() => makeTitleTexture(theme.titleInk === 'dark'), [theme.titleInk])
  useEffect(() => () => disposeAll([tex]), [tex])

  const w = Math.min(9.6, layout.hd * 2 - 1.4)

  return (
    <>
      <mesh position={[-layout.hw + 0.03, 2.55, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[w, w / 2]} />
        {/* ライティングに馴染むようスポットライトの光を受けるマテリアルにする */}
        <meshStandardMaterial map={tex} transparent roughness={0.9} />
      </mesh>
      <SpotWithTarget
        position={[-layout.hw + 3.4, CEIL_H - 0.2, 0]}
        targetPosition={[-layout.hw, 2.5, 0]}
        color={theme.spotColor}
        intensity={30}
        angle={0.75}
        penumbra={0.7}
        decay={1.1}
      />
    </>
  )
}
