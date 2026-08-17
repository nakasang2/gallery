'use client'
// ヒーローの3Dシーンを条件付きで読み込むゲート。
// 走らせてよい環境なら、モバイルでも本物の3Dを出す(SNS層=スマホ中心のため)。
// 出さない環境（省モーション / WebGL非対応 / GPUが無くCPUで描いている）では、
// CSSの額装フォールバックに任せる(何も描かない)。判定は lib/hero3d に1つだけ置く
// ── LandingEffects も同じ答えを見て、3Dが出るときは額装を焼かない。
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { canRunHero3d } from '@/lib/hero3d'

const HeroScene = dynamic(() => import('./HeroScene'), { ssr: false })

export default function HeroCanvas() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    setEnabled(canRunHero3d())
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
