'use client'
// Owner-only private preview. When the signed-in viewer owns a PRIVATE gallery
// at this handle, take over the page and let them walk it (with a "private
// preview" banner) — so an owner can see their draft at its real public URL
// before publishing. Renders nothing for anyone else (anonymous visitors, other
// users, or when the gallery is public), so the public server page is completely
// unaffected. (docs/DECISIONS 2026-07-27)
import { useEffect, useState } from 'react'
import { fetchOwnExhibition, type PublicExhibition } from '@/lib/publish'
import VisitorGallery from '@/components/gallery/VisitorGallery'

export default function OwnerPreview({ handle }: { handle: string }) {
  const [ex, setEx] = useState<PublicExhibition | null>(null)

  useEffect(() => {
    let alive = true
    fetchOwnExhibition(handle)
      .then((e) => alive && setEx(e))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [handle])

  if (!ex) return null
  return <VisitorGallery exhibition={ex} ownerPreview />
}
