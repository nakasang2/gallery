'use client'
// テーマの「空気」をシーンに当てる。
//
// 背景色と指数フォグは、**実際の展示室（GalleryScene）とダッシュボードのテーマ
// プレビュー（components/Preview3D）の両方**が必要とする。写すと片方だけ古くなるので
// 1か所に置く（【絶対ルール】2026-08-12）。
//
// プレビューが長らく `theme.fog` を**背景の単色として置くだけ**で `fogDensity` を
// 使っていなかったため、奥行きに応じて色が沈む「空気遠近」がプレビューには
// 出ていなかった ── テーマごとの奥行きの出方がいちばん変わる要素なのに。
import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { ThemeDef } from '@/lib/presets'

/** 背景とフォグをテーマに合わせる。フォグはコンポーネントが消えるときに外す。 */
export function useThemeAtmosphere(theme: ThemeDef) {
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    scene.background = new THREE.Color(theme.fog)
    scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity)
    return () => {
      scene.fog = null
    }
  }, [scene, theme])
}
