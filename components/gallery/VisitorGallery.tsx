'use client'
// Visitor view of a public gallery: put the store in visitor mode and render GalleryApp read-only
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useGallery } from '@/lib/store'
import type { PublicExhibition } from '@/lib/publish'

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

export default function VisitorGallery({ exhibition }: { exhibition: PublicExhibition }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    document.body.classList.add('gallery-mode')
    useGallery.setState({ visitor: exhibition })
    setArmed(true)
    return () => {
      document.body.classList.remove('gallery-mode')
      useGallery.setState({ visitor: null })
    }
  }, [exhibition])

  return armed ? <GalleryApp /> : null
}
