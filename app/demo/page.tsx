'use client'
// 3D gallery (guest experience). WebGL is browser-only, so load it with SSR disabled
import { useEffect } from 'react'
import dynamic from 'next/dynamic'

const GalleryApp = dynamic(() => import('@/components/gallery/GalleryApp'), {
  ssr: false,
  loading: () => (
    <div id="loading">
      <div className="loading-inner">
        <div className="loading-logo">HAKONIWA</div>
        <div className="loading-bar"><span></span></div>
        <div className="loading-text">Preparing the gallery…</div>
      </div>
    </div>
  ),
})

export default function DemoPage() {
  // Shares CSS with the landing page, so put body in gallery mode only while this page is mounted
  useEffect(() => {
    document.body.classList.add('gallery-mode')
    return () => document.body.classList.remove('gallery-mode')
  }, [])

  return <GalleryApp />
}
