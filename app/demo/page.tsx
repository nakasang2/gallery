'use client'
// 3Dギャラリー(ゲスト体験)。WebGL はブラウザ専用なので SSR を切って読み込む
import { useEffect } from 'react'
import dynamic from 'next/dynamic'

const GalleryApp = dynamic(() => import('@/components/gallery/GalleryApp'), {
  ssr: false,
  loading: () => (
    <div id="loading">
      <div className="loading-inner">
        <div className="loading-logo">HAKONIWA</div>
        <div className="loading-bar"><span></span></div>
        <div className="loading-text">ギャラリーを準備しています…</div>
      </div>
    </div>
  ),
})

export default function DemoPage() {
  // LP と CSS を共有しているため、このページの間だけ body をギャラリー用モードに
  useEffect(() => {
    document.body.classList.add('gallery-mode')
    return () => document.body.classList.remove('gallery-mode')
  }, [])

  return <GalleryApp />
}
