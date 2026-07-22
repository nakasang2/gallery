'use client'
// 3D gallery (guest experience). WebGL is browser-only, so load it with SSR disabled
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import LoadingScreen from '@/components/gallery/LoadingScreen'
import { fetchDemoLook } from '@/lib/siteConfig'

const GalleryApp = dynamic(() => import('@/components/gallery/GalleryApp'), {
  ssr: false,
  loading: () => <LoadingScreen />,
})

export default function DemoPage() {
  // The admin-configured demo theme (/admin → Demo look), applied once the room settles
  const [demoTheme, setDemoTheme] = useState<string | null>(null)

  // Shares CSS with the landing page, so put body in gallery mode only while this page is mounted
  useEffect(() => {
    document.body.classList.add('gallery-mode')
    let alive = true
    fetchDemoLook()
      .then((look) => alive && setDemoTheme(look?.theme ?? null))
      .catch(() => {})
    return () => {
      alive = false
      document.body.classList.remove('gallery-mode')
    }
  }, [])

  return <GalleryApp demo demoTheme={demoTheme} />
}
