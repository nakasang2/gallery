'use client'
// 部屋どうしをつなぐ扉（ユーザー決定 2026-08-09）。ここが持つのは**見た目**だけで、
// 「どこに開くか」は `./doorway` が持つ ── 壁を切り抜く `Room` と同じ答えを見るため。
//
// 多室の展示は `galleries` の行が複数あるもので、部屋の移動は**ページ遷移**（ユーザーの
// 判断）。だからこのファイルは小さい: シーンが描くのは常に1部屋で、扉は「枠＋奥の廊下＋
// 近接判定」でしかなく、通り抜けはナビゲーションになる。
//
// **壁は切り抜く**（ユーザー選択 2026-08-13・A案）。以前は「壁を切り抜かずに 0.52m 手前へ
// 置いた箱」で、実機では①枠が壁から浮いて見え②奥行き 0.4m では床が途切れて奥行きが
// 出なかった。切り抜けば廊下は**壁の裏＝部屋の外**に置けるので、部屋を狭めずに 1.2m
// 取れる。壁の穴を開けるのは `Room`（`useDoorway` の答えを共有している）。
//
// ONE door per room, however many other rooms there are (ユーザー決定 2026-08-09). The
// door is the way out; which room it opens onto is chosen AT the door, in the HUD. One
// opening per room needed spacing, a cap and a shrinking gap, and three separate bugs
// lived in that arithmetic — none of which can exist now.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { LayoutDef } from '@/lib/presets'
import { useGallery } from '@/lib/store'
import { track } from '@/lib/analytics'
import { roomPath, type SiblingRoom } from '@/lib/publish'
import { getDoorwayDepth, getFloorTextures, disposeAll } from './textures'
import { TRIM_COLOR } from './Room'
import {
  useDoorway,
  DOOR_W,
  DOOR_H,
  JAMB,
  JAMB_D,
  WALL_TUNNEL_D,
  FREE_TUNNEL_D,
  type DoorPlacement,
  type WallHole,
} from './doorway'

/** How close the camera has to be for the doorway to offer itself. Generous, because
 *  the prompt is a suggestion — the visitor still has to press it. */
const NEAR_DIST = 2.8

/** 廊下の床。**部屋の床の続き**に見えるよう同じ板材テクスチャを実寸（1枚 5.3m × 2.66m）で
 *  張る。ここが「奥行きを感じる」の本体なので、**照明に依存させ切らない**: 弱い
 *  `emissive` を板目そのものの絵で入れて、光が回らなくても板が見える下限を作る
 *  （切り抜き前の 0.4m の凹みは実機で真っ黒に見えていた ── 理屈では光が回るはずなのに、で
 *  ある。原因を突き止める前に「見える下限」を作る方が確実）。 */
function CorridorFloor({ depth, sideways }: { depth: number; sideways: boolean }) {
  const tex = useMemo(() => {
    const base = getFloorTextures()
    const map = base.map.clone()
    const bumpMap = base.bumpMap.clone()
    // 板の**向き**を部屋と合わせる。部屋の床は `rotation-x` だけのプレーンで、板の長手
    // （1タイル 5.3m 側）が**世界の X 軸**に沿う。廊下の床は扉のローカル座標なので、
    // 東西の壁（`rotY = ±π/2`）ではローカル X が世界の Z を向く ── そのまま同じ
    // repeat を使うと**板目が敷居で 90° 回る**（別視点レビューで検出。「床が続いて
    // 見える」ことが目的なので、ここがずれると変更の意味が無くなる）。
    const rep: [number, number] = sideways ? [DOOR_W / 2.66, depth / 5.3] : [DOOR_W / 5.3, depth / 2.66]
    for (const t of [map, bumpMap]) t.repeat.set(...rep)
    return { map, bumpMap }
  }, [depth, sideways])
  useEffect(() => () => disposeAll([tex.map, tex.bumpMap]), [tex])
  return (
    <mesh position={[0, 0, -depth / 2]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[DOOR_W, depth]} />
      <meshStandardMaterial
        map={tex.map}
        bumpMap={tex.bumpMap}
        bumpScale={0.5}
        color={0x6b5a45}
        roughness={0.92}
        emissive={0xffffff}
        emissiveMap={tex.map}
        emissiveIntensity={0.18}
      />
    </mesh>
  )
}

/** 扉の見た目は**テーマにも近接状態にも依存しない**。造作の色（`TRIM_COLOR`）と
 *  開口の奥の暗がりだけで出来ていて、「この扉は使える」は HUD（`RoomSwitch`）が言葉で
 *  伝える。テーマ色を借りると、明るいテーマで枠や敷居が灰色の板に見える（2026-08-12/13
 *  に2回。`emissive` は**リニア値**なので、控えめなつもりの 0.12 でも sRGB では中間グレー
 *  約 102/255 になり、near-black の枠が灰色の板に化けた）。 */
function Doorway({
  at,
  rotY,
  hole,
  onEnter,
}: {
  at: THREE.Vector3
  rotY: number
  /** 壁を切り抜いた開口ならその情報。`null` は最後の手段の自立配置。 */
  hole: WallHole | null
  onEnter: () => void
}) {
  const gl = useThree((s) => s.gl)
  // 切り抜いた壁なら廊下は壁の裏。切り抜けない最後の手段（自立配置）だけ浅くする。
  const tunnelD = hole ? WALL_TUNNEL_D : FREE_TUNNEL_D
  /** 廊下の内壁（側壁・天井）は `z = 0` からではなく**枠の箱が終わる位置から**張る。
   *  同じ平面に枠の内側の面（左右の枠なら `|x| = DOOR_W/2`、まぐさなら `y = DOOR_H`）が
   *  既に居るので、`z = 0` から張ると重なった区間が**完全な同一平面になり Zファイティング
   *  でちらつく**（2026-08-13 の別視点レビューで3組検出）。枠とは端で接するので隙間は
   *  できない。 */
  const innerD = tunnelD - JAMB_D / 2
  const innerZ = -(JAMB_D / 2 + tunnelD) / 2
  return (
    <group position={at} rotation-y={rotY}>
      {/* 枠（左右＋まぐさ）。壁の面を中心に置くので半分が部屋側、半分が開口の中 ──
          実際のドア枠の納まりで、これが「面一に見える」の本体。色は部屋の幅木と同じ。 */}
      {[
        { pos: [-(DOOR_W / 2 + JAMB / 2), DOOR_H / 2, 0] as const, size: [JAMB, DOOR_H, JAMB_D] as const },
        { pos: [DOOR_W / 2 + JAMB / 2, DOOR_H / 2, 0] as const, size: [JAMB, DOOR_H, JAMB_D] as const },
        { pos: [0, DOOR_H + JAMB / 2, 0] as const, size: [DOOR_W + JAMB * 2, JAMB, JAMB_D] as const },
      ].map((j, i) => (
        <mesh key={`j${i}`} position={[...j.pos]}>
          <boxGeometry args={[...j.size]} />
          <meshStandardMaterial color={TRIM_COLOR} roughness={0.7} />
        </mesh>
      ))}
      {/* 開口の奥の廊下。ローカル -z が壁の裏（部屋の外）、+z が部屋の側。
          側壁と天井は `DoubleSide` の1マテリアルで兼用する: 内側から見れば廊下の内壁、
          外側から見れば枠と同じ暗色の箱。面を2組持たない。 */}
      {/* 奥の面。ここだけ `meshBasicMaterial` で照明に依存させない ── テーマの明るさで
          奥が明るくなると「穴」に見えなくなる。勾配は中心が最も暗い（getDoorwayDepth）。 */}
      <mesh position={[0, DOOR_H / 2, -tunnelD]}>
        <planeGeometry args={[DOOR_W, DOOR_H]} />
        <meshBasicMaterial map={getDoorwayDepth()} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* 側壁（左右） */}
      {[-1, 1].map((sx) => (
        <mesh key={`tw${sx}`} position={[(sx * DOOR_W) / 2, DOOR_H / 2, innerZ]} rotation-y={Math.PI / 2}>
          <planeGeometry args={[innerD, DOOR_H]} />
          <meshStandardMaterial color={TRIM_COLOR} roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* 天井 */}
      <mesh position={[0, DOOR_H, innerZ]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[DOOR_W, innerD]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* 床。**切り抜いた開口のときだけ**置く ── 壁の裏には部屋の床が無いので、置かないと
          床が抜ける。自立配置（`hole: null`）では部屋の床がそのまま下を通っているので
          置いてはいけない: `y = 0` で完全な同一平面になり Zファイティングでちらつく
          （ユーザー報告 2026-08-12「下部がちらついてる」）。切り抜いた側は部屋の床が
          壁の線で終わり、廊下の床はそこから外へ伸びるので、**辺で接するだけで重ならない**。 */}
      {hole && <CorridorFloor depth={tunnelD} sideways={hole.wall === 'east' || hole.wall === 'west'} />}
      {/* クリックの的は開口いっぱい（見えないまま）。扉は主要な移動手段なので的は大きく
          保つ。`opacity: 0` でもレイキャストは通る（three は `visible` を見るが不透明度は
          見ない）。 */}
      <mesh
        position={[0, DOOR_H / 2, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onEnter()
        }}
        onPointerOver={() => (gl.domElement.style.cursor = 'pointer')}
        onPointerOut={() => (gl.domElement.style.cursor = '')}
      >
        <planeGeometry args={[DOOR_W, DOOR_H]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

export default function RoomPortals({ layout }: { layout: LayoutDef }) {
  const camera = useThree((s) => s.camera)
  const visitor = useGallery((s) => s.visitor)
  const setAtDoorway = useGallery((s) => s.setAtDoorway)
  const setRoomPickerOpen = useGallery((s) => s.setRoomPickerOpen)

  // The OTHER public rooms. `rooms` always contains the current one, so filtering it
  // out is what turns a single-room show into "no doorway at all".
  const others = useMemo<SiblingRoom[]>(
    () => (visitor?.rooms ?? []).filter((r) => r.slug !== visitor?.slug),
    [visitor]
  )
  // 位置は `Room`（壁を切り抜く側）と同じ関数から取る。ここで独自に計算すると、
  // 穴の位置と扉の位置が食い違って**壁に穴が空いたまま扉が無い**状態を作れてしまう。
  const place: DoorPlacement | null = useDoorway(layout)

  // Proximity. One door, so this is a single distance test — and `setAtDoorway` ignores
  // an unchanged value, so standing still costs no re-renders.
  useFrame(() => {
    if (!place) return
    const d = Math.hypot(camera.position.x - place.pos.x, camera.position.z - place.pos.z)
    setAtDoorway(d < NEAR_DIST)
  })

  // Unmounting (leaving the room, or the door going away) must not strand a stale prompt
  // or an open picker in the HUD.
  useEffect(
    () => () => {
      setAtDoorway(false)
      setRoomPickerOpen(false)
    },
    [setAtDoorway, setRoomPickerOpen]
  )

  if (!visitor || !others.length || !place) return null

  /** Through the door. With one other room there is nothing to choose, so go straight
   *  there; with several, the door asks which one (ユーザー決定 2026-08-09). */
  const go = () => {
    if (others.length === 1) enterRoom(visitor, others[0])
    else setRoomPickerOpen(true)
  }

  return <Doorway at={place.pos} rotY={place.rotY} hole={place.hole} onEnter={go} />
}

/** Walk through to another room: a full navigation, which is what makes this cheap
 *  (the whole scene is rebuilt for the new room rather than swapped in place).
 *  The front-door room lives at `/@name` (a joint exhibition's lobby at
 *  `/expo/{name}`), everything else one level under it — `roomPath` is the ONE place
 *  that mapping lives, and `lib/seo.exhibitionPath` canonicalises through the same
 *  function, so a doorway never links to a URL that redirects, 404s or duplicates. */
export function enterRoom(from: { username: string; expo: { slug: string } | null }, room: SiblingRoom): void {
  const path = roomPath(from, room)
  const embed = useGallery.getState().embed
  track('room_enter', { to: room.slug, main: room.isMain, embed, expo: from.expo?.slug ?? null })
  // Embedded, this gallery is a frame on somebody else's page: navigating it would
  // silently replace their embed with a different room. Same rule the rest of the HUD
  // follows for outbound links in an embed — open it, don't hijack the frame.
  if (embed) window.open(path, '_blank', 'noopener')
  else window.location.assign(path)
}
