'use client'
// Title wall — the artist's board on the west accent wall.
// Visitors see the exhibition title + artist + statement; a signed-in owner sees
// THEIR board (title / name / concept, edited from the dashboard) with their avatar;
// guests on /demo keep the HAKONIWA demo copy.
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { CEIL_H, type LayoutDef, type ThemeDef } from '@/lib/presets'
import { useGallery } from '@/lib/store'
import { makeTitleTexture, DEFAULT_TITLE_TEXT, disposeAll, type TitleWallText } from './textures'
import { loadImage } from '@/lib/upload'
import SpotWithTarget from './SpotWithTarget'
import LightCone from './LightCone'

// Split a free-form statement into the two note lines (second may be empty)
function statementNotes(statement: string, fallback1: string, fallback2: string) {
  const s = statement.trim()
  if (!s) return { note1: fallback1, note2: fallback2 }
  return { note1: s, note2: '' } // makeTitleTexture wraps note1 over both lines
}

export default function TitleWall({ theme, layout }: { theme: ThemeDef; layout: LayoutDef }) {
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const myGallery = useGallery((s) => s.myGallery)
  const profileDisplayName = useGallery((s) => s.profileDisplayName)
  const profileAvatarUrl = useGallery((s) => s.profileAvatarUrl)

  // Whose board is this?
  const { text, avatarUrl } = useMemo((): { text: TitleWallText; avatarUrl: string | null } => {
    if (visitor) {
      return {
        text: {
          main: visitor.title,
          sub: `— ${visitor.ownerName} —`,
          ...statementNotes(visitor.statement, `@${visitor.username}`, ''),
        },
        avatarUrl: visitor.ownerAvatar,
      }
    }
    if (user && myGallery) {
      return {
        text: {
          main: myGallery.title,
          sub: `— ${profileDisplayName || user.displayName} —`,
          ...statementNotes(
            myGallery.statement,
            'Tell visitors what this exhibition is about —',
            'add your intro from the dashboard (Edit details).'
          ),
        },
        avatarUrl: profileAvatarUrl,
      }
    }
    return { text: DEFAULT_TITLE_TEXT, avatarUrl: null }
  }, [visitor, user, myGallery, profileDisplayName, profileAvatarUrl])

  // Avatar loads async; the texture bakes once it's ready (or immediately without one)
  const [avatarImg, setAvatarImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    let alive = true
    setAvatarImg(null)
    if (!avatarUrl) return
    loadImage(avatarUrl, true)
      .then((img) => alive && setAvatarImg(img))
      .catch(() => {}) // CORS or 404 — board simply renders without the icon
    return () => {
      alive = false
    }
  }, [avatarUrl])

  const tex = useMemo(
    () => makeTitleTexture(theme.titleInk === 'dark', text, avatarImg),
    [theme.titleInk, text, avatarImg]
  )
  useEffect(() => () => disposeAll([tex]), [tex])

  const w = Math.min(9.6, layout.hd * 2 - 1.4)

  return (
    <>
      <mesh position={[-layout.hw + 0.03, 2.55, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[w, w / 2]} />
        {/* Use a material that catches the spotlight so it blends with the lighting */}
        <meshStandardMaterial map={tex} transparent roughness={0.9} />
      </mesh>
      <SpotWithTarget
        position={[-layout.hw + 3.4, CEIL_H - 0.2, 0]}
        targetPosition={[-layout.hw, 2.5, 0]}
        color={theme.spotColor}
        intensity={30}
        angle={0.75}
        penumbra={0.7}
        decay={1.1}
      />
      <LightCone
        from={new THREE.Vector3(-layout.hw + 3.4, CEIL_H - 0.2, 0)}
        to={new THREE.Vector3(-layout.hw, 2.5, 0)}
        angle={0.75}
        color={theme.spotColor}
        opacity={theme.coneOpacity * 0.8}
      />
    </>
  )
}
