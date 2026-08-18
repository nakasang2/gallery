'use client'
// Title wall — the artist's board on the west accent wall.
// Visitors see the exhibition title + artist + statement; a signed-in owner sees
// THEIR board (title / name / concept, edited from the dashboard) with their avatar;
// guests on /demo keep the Xibit360 demo copy.
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { CEIL_H, type LayoutDef, type ThemeDef } from '@/lib/presets'
import { useGallery, useSettings } from '@/lib/store'
import { isPlaceholderTitle } from '@/lib/publish'
import { roomExhibitor, titleWallWidth } from '@/lib/roomPlan'
import { makeTitleTexture, DEFAULT_TITLE_TEXT, disposeAll, type TitleWallText } from './textures'
import { walkRef } from '@/lib/controller'
import { loadImage } from '@/lib/upload'
import SpotWithTarget from './SpotWithTarget'
import { PERF } from '@/lib/perfFlags'
import LightCone from './LightCone'
import TrackFixture, { fixtureAperture } from './TrackFixture'

// The artist's board, grouped into two blocks: the EXHIBITION (title +
// statement) and the ARTIST (avatar + name + handle + bio). With no real title
// (empty or the old "My Gallery" default), the artist's name leads the title.
function boardText(opts: {
  title: string
  name: string
  username: string | null
  statement: string
  bio: string
}): TitleWallText {
  const placeholder = isPlaceholderTitle(opts.title)
  return {
    title: placeholder ? opts.name : opts.title,
    statement: opts.statement.trim(),
    artist: {
      name: opts.name,
      handle: opts.username ?? undefined,
      bio: opts.bio.trim(),
    },
  }
}

export default function TitleWall({ theme, layout }: { theme: ThemeDef; layout: LayoutDef }) {
  const gl = useThree((s) => s.gl)
  const settings = useSettings()
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const myGallery = useGallery((s) => s.myGallery)
  const profileUsername = useGallery((s) => s.profileUsername)
  const profileDisplayName = useGallery((s) => s.profileDisplayName)
  const profileAvatarUrl = useGallery((s) => s.profileAvatarUrl)
  const profileBio = useGallery((s) => s.profileBio)

  // Whose board is this?
  const { text, avatarUrl } = useMemo((): { text: TitleWallText; avatarUrl: string | null } => {
    if (visitor) {
      // Not `visitor.ownerName` — the board names whoever is EXHIBITING in this room,
      // which in a joint show is the artist when the room is theirs alone and the
      // collective when the walls are mixed (lib/roomPlan.roomExhibitor).
      const by = roomExhibitor(visitor)
      return {
        text: boardText({
          title: visitor.title,
          name: by.name,
          username: by.username,
          statement: visitor.statement,
          bio: by.bio,
        }),
        avatarUrl: by.avatarUrl,
      }
    }
    if (user && myGallery) {
      const text = boardText({
        title: myGallery.title,
        name: profileDisplayName || user.displayName,
        username: profileUsername,
        statement: myGallery.statement,
        bio: profileBio ?? '',
      })
      // Nothing personal written yet — nudge once, in the statement slot
      if (!text.statement && !text.artist?.bio) {
        text.statement = 'Tell visitors about this exhibition — add your intro and bio from the dashboard.'
      }
      return { text, avatarUrl: profileAvatarUrl }
    }
    return { text: DEFAULT_TITLE_TEXT, avatarUrl: null }
  }, [visitor, user, myGallery, profileUsername, profileDisplayName, profileAvatarUrl, profileBio])

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

  // Design Tools logo (§11.5/§11.8) — same async-load-then-bake pattern as the avatar
  const logoUrl = settings.designOverrides.logoUrl
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    let alive = true
    setLogoImg(null)
    if (!logoUrl) return
    loadImage(logoUrl, true)
      .then((img) => alive && setLogoImg(img))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [logoUrl])

  const tex = useMemo(
    () => makeTitleTexture(theme.titleInk === 'dark', text, avatarImg, logoImg),
    [theme.titleInk, text, avatarImg, logoImg]
  )
  useEffect(() => () => disposeAll([tex]), [tex])

  const w = titleWallWidth(layout)

  const onClick = openExhibitionInfo
  const onOver = () => (gl.domElement.style.cursor = 'pointer')
  const onOut = () => (gl.domElement.style.cursor = '')

  return (
    <>
      <mesh
        position={[-layout.hw + 0.03, 2.55, 0]}
        rotation-y={Math.PI / 2}
        onClick={onClick}
        onPointerOver={onOver}
        onPointerOut={onOut}
      >
        <planeGeometry args={[w, w / 2]} />
        {/* Use a material that catches the spotlight so it blends with the lighting */}
        <meshStandardMaterial map={tex} transparent roughness={0.9} />
      </mesh>
      {/* decay 2 = the same physical falloff as the exhibit spots; intensity is
          rebalanced for the ~3.6m throw so the board reads as before */}
      {/* `?perf=nolights` は測定専用（照明19個が1ピクセルあたりの重さの正体かを測る） */}
      {PERF.lights && (
      <SpotWithTarget
        position={[-layout.hw + 3.4, CEIL_H - 0.2, 0]}
        targetPosition={[-layout.hw, 2.5, 0]}
        color={theme.spotColor}
        intensity={95}
        angle={0.75}
        penumbra={0.7}
        decay={2}
      />
      )}
      <LightCone
        from={fixtureAperture(
          new THREE.Vector3(-layout.hw + 3.4, CEIL_H - 0.2, 0),
          new THREE.Vector3(-layout.hw, 2.5, 0)
        )}
        to={new THREE.Vector3(-layout.hw, 2.5, 0)}
        angle={0.75}
        color={theme.spotColor}
        opacity={theme.coneOpacity * 0.8}
      />
      <TrackFixture
        at={new THREE.Vector3(-layout.hw + 3.4, CEIL_H - 0.2, 0)}
        target={new THREE.Vector3(-layout.hw, 2.5, 0)}
        color={theme.spotColor}
      />
    </>
  )
}

/** タイトルウォールを押したときの動作。**この1か所だけが「展示情報を開く」を決める。**
 *  板（このファイル）と**壁そのもの**（`Room` の西壁。ユーザー要望 2026-08-13「奥の壁を
 *  押下したときに表示したい」）の両方から呼ばれるので、当たり判定が2つでも振る舞いは1つ。
 *  タップの判定（`e.delta`）は `WalkControls` と同じ閾値 ── ドラッグで視点を回した指を
 *  離した瞬間にパネルが開かないように。 */
export function openExhibitionInfo(e: ThreeEvent<MouseEvent>): void {
  e.stopPropagation()
  if (e.delta > 10) return
  walkRef.current?.focusWall() // glide to face the board, like focusing a work
  useGallery.getState().setInfoOpen(true)
}
