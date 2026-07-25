'use client'
// Your own room, walked in 3D (owner view). Split out from /demo, which is the
// public house showcase: one route can't be both, and while it tried, any
// signed-in visitor who followed "Walk the demo" from the landing page got their
// own gallery instead of the sample collection.
//
// This is the owner's private walk, so it works before publishing — the public
// page /@user/slug is gated on is_public (and can't be published with zero works),
// which leaves exactly the window this route covers.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { useGallery } from '@/lib/store'
import LoadingScreen from '@/components/gallery/LoadingScreen'

const GalleryApp = dynamic(() => import('@/components/gallery/GalleryApp'), {
  ssr: false,
  loading: () => <LoadingScreen />,
})

export default function RoomPage() {
  const user = useGallery((s) => s.user)
  // false = auth still resolving; don't flash "sign in" at a signed-in owner
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    useGallery.getState().initAuth()
    supabase?.auth.getSession().then(() => setChecked(true))
    // No Supabase configured at all: nothing can resolve, so stop waiting
    if (!supabase) setChecked(true)
  }, [])

  // Shares CSS with the landing page, so put body in gallery mode only while mounted
  useEffect(() => {
    document.body.classList.add('gallery-mode')
    return () => document.body.classList.remove('gallery-mode')
  }, [])

  if (!user) {
    if (!checked) return <LoadingScreen />
    return (
      <main className="me-page">
        <div className="me-inner">
          <div className="me-top">
            <Link href="/" className="auth-logo">XIBIT360</Link>
          </div>
          <div className="me-card">
            <p className="me-note" style={{ marginTop: 0 }}>
              Sign in to walk your own room — or walk the sample show instead.
            </p>
            <div className="hako-actions">
              <Link className="btn-line" href="/signin">Sign in</Link>
              <Link className="btn-line" href="/demo">Walk the demo</Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return <GalleryApp />
}
