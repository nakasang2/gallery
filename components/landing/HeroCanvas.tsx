'use client'
// ヒーローの3Dシーンを条件付きで読み込むゲート。
// 走らせてよい環境なら、モバイルでも本物の3Dを出す(SNS層=スマホ中心のため)。
// 出さない環境（省モーション / WebGL非対応 / GPUが無くCPUで描いている）では、
// CSSの額装フォールバックに任せる(何も描かない)。判定は lib/hero3d に1つだけ置く
// ── LandingEffects も同じ答えを見て、3Dが出るときは額装を焼かない。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { canRunHero3d } from '@/lib/hero3d'

const HeroScene = dynamic(() => import('./HeroScene'), { ssr: false })

export default function HeroCanvas() {
  const [enabled, setEnabled] = useState(false)
  // WebGLコンテキストを喪失したら(iOS Safariのアプリ切替/メモリ逼迫等)、以後は
  // CSSの額装フォールバックに委ねる。GalleryApp.tsx と違って再構築は試みない —
  // このcanvasは装飾で、再構築は150MB超のテクスチャの再取得をメモリ逼迫の直後に
  // 走らせることになり、喪失ループになりかねない(components/landing/HeroScene.tsx)。
  const [lost, setLost] = useState(false)
  // has-hero3d が外れると .corridor / .closing の高さ(vh指定)がCSS側で縮む(3D廊下の
  // 歩行距離を確保するための高さなので、3Dが無ければ要らない)。何もしないと来場者の
  // 今のスクロール位置がその分だけ後ろのセクションへ弾き飛ばされる(別視点レビューで
  // 指摘・実測)ので、喪失前後でスクロール比率を保つ。
  const scrollRatioRef = useRef<number | null>(null)

  useEffect(() => {
    setEnabled(canRunHero3d())
  }, [])

  // 3Dが有効なときだけ廊下を「歩く」レイアウトにする(CSSが .has-hero3d を参照)。
  // スクロール比率の復元も**同じeffectの中**で行う ── 別のeffectに分けると、クラス
  // 除去(このeffectのクリーンアップ)より先に走ってしまい古い高さで計算する事故になる
  // （実測で発見。Reactはeffectの種類ごとに実行順が決まるため、クリーンアップの直後に
  // 続けたい処理は同じeffect本体に置く）。ペイント前に直すため useLayoutEffect にする。
  useLayoutEffect(() => {
    if (!enabled || lost) {
      if (lost && scrollRatioRef.current != null) {
        const max = document.documentElement.scrollHeight - window.innerHeight
        if (max > 0) window.scrollTo({ top: scrollRatioRef.current * max, behavior: 'instant' })
        scrollRatioRef.current = null
      }
      return
    }
    document.documentElement.classList.add('has-hero3d')
    return () => document.documentElement.classList.remove('has-hero3d')
  }, [enabled, lost])

  if (!enabled || lost) return null
  return (
    <HeroScene
      onContextLost={() => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        scrollRatioRef.current = max > 0 ? window.scrollY / max : 0
        setLost(true)
        // LandingEffects は3Dが最初から出ない環境でだけ額装フォールバックを焼く
        // （3Dが出るときは1枚も焼かない設計）。後から落ちたこの場合は、それより
        // 前に焼く判断が済んでいるので、ここで改めて焼くよう知らせる。
        window.dispatchEvent(new Event('hero3d-lost'))
      }}
    />
  )
}
