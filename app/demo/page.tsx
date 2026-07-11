'use client'
// 3D gallery (guest experience). WebGL is browser-only, so load it with SSR disabled
import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import LoadingScreen from '@/components/gallery/LoadingScreen'

const GalleryApp = dynamic(() => import('@/components/gallery/GalleryApp'), {
  ssr: false,
  loading: () => <LoadingScreen />,
})

export default function DemoPage() {
  // Shares CSS with the landing page, so put body in gallery mode only while this page is mounted
  useEffect(() => {
    document.body.classList.add('gallery-mode')
    return () => document.body.classList.remove('gallery-mode')
  }, [])

  return <GalleryApp />
}
