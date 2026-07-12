'use client'
// Visitor view of a public gallery: put the store in visitor mode and render GalleryApp read-only
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useGallery } from '@/lib/store'
import { recordVisit } from '@/lib/engagement'
import LoadingScreen from '@/components/gallery/LoadingScreen'
import type { PublicExhibition } from '@/lib/publish'

// No dynamic() fallback here — the personalised LoadingScreen below covers the
// chunk load, and GalleryApp renders the IDENTICAL screen the moment it mounts
// (visitor mode is already in the store), so the door never flickers.
const GalleryApp = dynamic(() => import('@/components/gallery/GalleryApp'), {
  ssr: false,
  loading: () => null,
})

export default function VisitorGallery({ exhibition }: { exhibition: PublicExhibition }) {
  const [armed, setArmed] = useState(false)
  const [shellUp, setShellUp] = useState(false)

  useEffect(() => {
    document.body.classList.add('gallery-mode')
    useGallery.setState({ visitor: exhibition })
    recordVisit(exhibition.galleryId) // analytics: one count per tab session
    setArmed(true)
    return () => {
      document.body.classList.remove('gallery-mode')
      useGallery.setState({ visitor: null })
    }
  }, [exhibition])

  return (
    <>
      {armed && <GalleryApp onShellReady={() => setShellUp(true)} />}
      {!shellUp && <LoadingScreen exhibition={exhibition} />}
    </>
  )
}
