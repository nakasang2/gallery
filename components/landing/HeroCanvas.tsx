'use client'
// ヒーローの3Dシーンを条件付きで読み込むゲート。
// WebGL 対応 かつ 省モーションでなければ、モバイルでも本物の3Dを出す(SNS層=スマホ中心のため)。
// 省モーション/WebGL非対応のみ、CSSの額装フォールバックに任せる(何も描かない)。
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

const HeroScene = dynamic(() => import('./HeroScene'), { ssr: false })

export default function HeroCanvas() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let webgl = false
    try {
      const c = document.createElement('canvas')
      webgl = !!(c.getContext('webgl2') || c.getContext('webgl'))
    } catch {
      webgl = false
    }
    setEnabled(!reduced && webgl)
  }, [])

  // 3Dが有効なときだけ廊下を「歩く」レイアウトにする(CSSが .has-hero3d を参照)
  useEffect(() => {
    if (!enabled) return
    document.documentElement.classList.add('has-hero3d')
    return () => document.documentElement.classList.remove('has-hero3d')
  }, [enabled])

  if (!enabled) return null
  return <HeroScene />
}
