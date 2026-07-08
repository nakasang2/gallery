'use client'
// LP専用の3D美術館。固定背景として全スクロールを通して常駐する、1本のカメラ旅路:
//   1. 入口: 右壁の主役アート(インパクト)
//   2. 反対側へ回り込み、番号パネル 01〜06 を順に見る(廊下)
//   3. そのまま廊下の先の「暗闇」へ前進 — 何もない空間なので背景は黒く沈み、
//      中間セクション(Concept〜Pricing)のテキストが読める
//   4. 終盤(Closing)でフォグの奥から「大部屋のギャラリー」が現れる — 廊下を抜けて広間へ
// カメラ位置に合わせて 2D の見出しをオーバーレイする。
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import { renderArtworkCanvas, ARTWORKS, mulberry32 } from '@/lib/artworks'

const WALL_X = 4.7
const ITEM_Y = 1.6
const CORRIDOR_END_Z = -39 // 廊下の壁が終わるz(この先は暗い空間)
const HALL_FAR = -124 // 大部屋の遠壁
const HALL_MOUTH = -88 // 大部屋の入口
const HALL_HALF = 18 // 大部屋の半幅

// 入口・右壁の主役アート [作品index, z]
const HERO_ART: [number, number][] = [
  [0, 6],
  [5, 1],
]

// 左壁の機能パネル 01〜06
const PANELS: { n: string; h: string; b: string; z: number }[] = [
  { n: '01', h: 'A solo show in the browser', b: 'No apps, no plugins. One link opens the gallery, and visitors walk it on desktop or phone.', z: -6 },
  { n: '02', h: 'Hang works by drag & drop', b: 'Upload an image and place it on a wall. Height, spacing and sightlines snap to the template.', z: -11 },
  { n: '03', h: 'Light and stage every piece', b: 'Spotlights, wall colour and flooring set the mood. Each work gets its own presentation.', z: -16 },
  { n: '04', h: 'One address, open worldwide', b: 'hakoniwa.app/@you — a permanent URL for your practice, made for any bio or portfolio.', z: -21 },
  { n: '05', h: 'Captions that carry the story', b: 'Title, year and statement are mounted beside each work, the way a museum label would be.', z: -26 },
  { n: '06', h: 'Guestbook & reactions', b: 'Footprints, notes, quiet appreciation — feedback that behaves like an exhibition, not a comment feed.', z: -31 },
]

// 大部屋の作品配置
// 遠壁(camera を向く +z 面) [idx, x, y, w]
const HALL_FRONT: [number, number, number, number][] = [
  [0, 0, 6.4, 7.2],
  [5, -9.4, 5.6, 4],
  [9, 9.4, 5.6, 4],
]
// 側壁 [idx, z, w, 'L'|'R']
const HALL_SIDES: [number, number, number, 'L' | 'R'][] = [
  [8, -100, 3.6, 'L'],
  [2, -114, 3.6, 'L'],
  [7, -100, 3.6, 'R'],
  [4, -114, 3.6, 'R'],
]

type Hud = { eyebrow: string; title: string }
const CORRIDOR_HUD: Hud[] = [
  { eyebrow: 'The room', title: 'Built around a single work.' },
  { eyebrow: 'The room', title: 'Walked, not scrolled.' },
  ...PANELS.map((p) => ({ eyebrow: `Features · ${p.n}`, title: p.h })),
]

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' ')
  let line = ''
  let yy = y
  for (const w of words) {
    const test = line ? line + ' ' + w : w
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy)
      line = w
      yy += lh
    } else line = test
  }
  if (line) ctx.fillText(line, x, yy)
  return yy
}

function makePanelTexture(p: { n: string; h: string; b: string }): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 900
  c.height = 1180
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#efeade'
  ctx.fillRect(0, 0, 900, 1180)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#cfc9b6'
  ctx.font = 'italic 400 320px "Instrument Serif", serif'
  ctx.fillText(p.n, 70, 372)
  ctx.fillStyle = '#191917'
  ctx.font = '600 62px "Geist", sans-serif'
  const hy = wrapText(ctx, p.h, 70, 580, 770, 76)
  ctx.fillStyle = '#5a584f'
  ctx.font = '400 38px "Geist", sans-serif'
  wrapText(ctx, p.b, 70, hy + 96, 770, 56)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function Spot({ pos, target, color = '#ffeed6', intensity = 120, angle = 0.55, distance = 13 }: { pos: [number, number, number]; target: [number, number, number]; color?: string; intensity?: number; angle?: number; distance?: number }) {
  const light = useRef<THREE.SpotLight>(null!)
  const tgt = useRef<THREE.Object3D>(null!)
  useEffect(() => {
    if (light.current && tgt.current) light.current.target = tgt.current
  }, [])
  return (
    <>
      <spotLight ref={light} position={pos} angle={angle} penumbra={0.7} intensity={intensity} distance={distance} decay={1.0} color={color} />
      <object3D ref={tgt} position={target} />
    </>
  )
}

function Panel({ p }: { p: { n: string; h: string; b: string; z: number } }) {
  const tex = useMemo(() => makePanelTexture(p), [p])
  useEffect(() => () => tex.dispose(), [tex])
  const w = 1.7
  const h = w * (1180 / 900)
  return (
    <group position={[-WALL_X + 0.08, ITEM_Y, p.z]} rotation-y={Math.PI / 2}>
      <mesh position={[0, 0, -0.04]}>
        <boxGeometry args={[w + 0.18, h + 0.18, 0.07]} />
        <meshStandardMaterial color="#141416" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} roughness={0.6} />
      </mesh>
      <Spot pos={[-WALL_X + 2.6, 4.2, p.z]} target={[-WALL_X, ITEM_Y, p.z]} intensity={130} />
    </group>
  )
}

// 額装作品(汎用): 壁の向きは rotationY で指定
function Framed({ idx, position, rotationY = 0, w = 1.5, y }: { idx: number; position: [number, number, number]; rotationY?: number; w?: number; y?: number }) {
  const art = ARTWORKS[idx]
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(renderArtworkCanvas(art, 720))
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [art])
  useEffect(() => () => tex.dispose(), [tex])
  const [rw, rh] = art.ratio
  const h = (w * rh) / rw
  const mat = 0.09 * w
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[w + mat * 2 + 0.12, h + mat * 2 + 0.12, 0.08]} />
        <meshStandardMaterial color="#141416" roughness={0.45} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0, 0.012]}>
        <planeGeometry args={[w + mat * 2, h + mat * 2]} />
        <meshStandardMaterial color="#e9e6dd" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} roughness={0.55} />
      </mesh>
    </group>
  )
}

function CorridorArt({ idx, z, side = 'R', scale = 1 }: { idx: number; z: number; side?: 'L' | 'R'; scale?: number }) {
  const x = side === 'L' ? -WALL_X + 0.08 : WALL_X - 0.08
  const ry = side === 'L' ? Math.PI / 2 : -Math.PI / 2
  const spotX = side === 'L' ? -WALL_X + 2.6 : WALL_X - 2.6
  const wallX = side === 'L' ? -WALL_X : WALL_X
  return (
    <group>
      <Framed idx={idx} position={[x, ITEM_Y, z]} rotationY={ry} w={1.5 * scale} />
      <Spot pos={[spotX, 4.2, z]} target={[wallX, ITEM_Y, z]} intensity={110} />
    </group>
  )
}

// 大部屋までの「アートが並ぶ通路」 [作品index, z, 壁] — 中間セクションの背景になる
const APPROACH_ART: [number, number, 'L' | 'R'][] = [
  [1, -46, 'R'],
  [4, -52, 'L'],
  [7, -58, 'R'],
  [2, -64, 'L'],
  [8, -70, 'R'],
  [9, -76, 'L'],
  [3, -82, 'R'],
]

// 大部屋
function Hall() {
  return (
    <group>
      {/* 床(廊下から続く長い反射床) */}
      {/* 遠壁 */}
      <mesh position={[0, 7, HALL_FAR]}>
        <planeGeometry args={[HALL_HALF * 2, 14]} />
        <meshStandardMaterial color="#211d19" roughness={0.99} />
      </mesh>
      {/* 側壁 */}
      <mesh position={[-HALL_HALF, 7, (HALL_FAR + HALL_MOUTH) / 2]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[HALL_MOUTH - HALL_FAR, 14]} />
        <meshStandardMaterial color="#241f1b" roughness={1} />
      </mesh>
      <mesh position={[HALL_HALF, 7, (HALL_FAR + HALL_MOUTH) / 2]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[HALL_MOUTH - HALL_FAR, 14]} />
        <meshStandardMaterial color="#201c18" roughness={1} />
      </mesh>
      {/* 天井 */}
      <mesh position={[0, 13.6, (HALL_FAR + HALL_MOUTH) / 2]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[HALL_HALF * 2, HALL_MOUTH - HALL_FAR]} />
        <meshStandardMaterial color="#121110" roughness={1} />
      </mesh>
      {/* 入口の袖壁(廊下→広間の"抜け"を作る) */}
      <mesh position={[-(WALL_X + (HALL_HALF - WALL_X) / 2), 7, HALL_MOUTH]} rotation-y={Math.PI}>
        <planeGeometry args={[HALL_HALF - WALL_X, 14]} />
        <meshStandardMaterial color="#26221e" roughness={0.98} />
      </mesh>
      <mesh position={[WALL_X + (HALL_HALF - WALL_X) / 2, 7, HALL_MOUTH]} rotation-y={Math.PI}>
        <planeGeometry args={[HALL_HALF - WALL_X, 14]} />
        <meshStandardMaterial color="#26221e" roughness={0.98} />
      </mesh>

      {/* 遠壁の作品 — 到着地点なので明るくきれいに見せる */}
      {HALL_FRONT.map(([idx, x, y, w], i) => (
        <group key={`hf${i}`}>
          <Framed idx={idx} position={[x, y, HALL_FAR + 0.1]} rotationY={0} w={w} />
          <Spot pos={[x, 12.6, HALL_FAR + 5.5]} target={[x, y, HALL_FAR]} intensity={340} angle={0.52} distance={26} />
        </group>
      ))}
      {/* 側壁の作品 */}
      {HALL_SIDES.map(([idx, z, w, side], i) => {
        const x = side === 'L' ? -HALL_HALF + 0.1 : HALL_HALF - 0.1
        const ry = side === 'L' ? Math.PI / 2 : -Math.PI / 2
        const sx = side === 'L' ? -HALL_HALF + 3 : HALL_HALF - 3
        return (
          <group key={`hs${i}`}>
            <Framed idx={idx} position={[x, 5.4, z]} rotationY={ry} w={w} />
            <Spot pos={[sx, 12, z]} target={[side === 'L' ? -HALL_HALF : HALL_HALF, 5.4, z]} intensity={240} angle={0.5} distance={22} />
          </group>
        )
      })}
      {/* 広間のやわらかな充填光(暗い通路より一段明るく、ギャラリーの空気に) */}
      <pointLight position={[0, 9, HALL_MOUTH - 12]} intensity={70} distance={50} decay={1.5} color="#efe6d4" />
      <pointLight position={[0, 8.5, HALL_FAR + 12]} intensity={64} distance={46} decay={1.5} color="#efe4d0" />
      <pointLight position={[0, 7, (HALL_FAR + HALL_MOUTH) / 2]} intensity={30} distance={54} decay={1.7} color="#e6ddcc" />
    </group>
  )
}

function Dust() {
  const ref = useRef<THREE.Points>(null!)
  const geo = useMemo(() => {
    const n = 480
    const rnd = mulberry32(4242)
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 18
      pos[i * 3 + 1] = rnd() * 7 + 0.3
      pos[i * 3 + 2] = rnd() * 140 - 130
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])
  useFrame((state) => {
    if (ref.current) ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.15) * 0.12
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.02} color="#ffeece" transparent opacity={0.4} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

// 縦画面(モバイル)判定 — カメラの画角・引きを縦向けに補正するために Rig が参照
let PORTRAIT = false
// 小さい画面(スマホ)は反射解像度/DPRを落として負荷を抑える
const SMALL_SCREEN = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700

// 画面比に応じて画角を調整し、縦画面では横の見切れを抑える
function ViewAdaptor() {
  const camera = useThree((s) => s.camera as THREE.PerspectiveCamera)
  const size = useThree((s) => s.size)
  useEffect(() => {
    PORTRAIT = size.height > size.width
    camera.fov = PORTRAIT ? 66 : 48
    camera.updateProjectionMatrix()
  }, [camera, size])
  return null
}

// ---- スクロール駆動のカメラ経路(区間はページ内のセクション位置に紐づく) ----
type Anchor = { atY: number; pos: THREE.Vector3; look: THREE.Vector3 }
let ANCHORS: Anchor[] = []

// revealTop: 大部屋がフォグの奥から現れ始めるスクロール位置(手前=早く見える)
function buildAnchors(corEnd: number, revealTop: number, footTop: number): Anchor[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const walk: { pos: THREE.Vector3; look: THREE.Vector3 }[] = []
  // 入口の右壁アート
  for (const [, z] of HERO_ART) walk.push({ pos: v(-1.7, 1.66, z + 1.4), look: v(WALL_X, 1.5, z) })
  // 左壁のパネル
  for (const p of PANELS) walk.push({ pos: v(1.9, 1.6, p.z + 0.9), look: v(-WALL_X + 0.3, 1.5, p.z) })

  const list: Anchor[] = []
  const walkSpan = Math.max(1, corEnd * 0.82)
  walk.forEach((w, i) => list.push({ atY: (i / (walk.length - 1)) * walkSpan, pos: w.pos, look: w.look }))
  // 廊下の口へ向き直り、暗闇へ前進しはじめる
  list.push({ atY: corEnd, pos: v(0, 1.75, CORRIDOR_END_Z + 2), look: v(0, 1.6, CORRIDOR_END_Z - 14) })
  // 暗い空間をゆっくり前進(Concept〜Demo = ほぼ黒)
  const midY = corEnd + (revealTop - corEnd) * 0.55
  list.push({ atY: midY, pos: v(0, 1.9, -48), look: v(0, 1.85, -64) })
  // 大部屋がフォグの奥から現れ始める(手前=Pricingあたりから)
  list.push({ atY: revealTop, pos: v(0, 2.2, -62), look: v(0, 2.5, -82) })
  // 広間の中へ(仰ぎ見る)
  list.push({ atY: footTop, pos: v(0, 3.6, HALL_MOUTH - 4), look: v(0, 4.4, HALL_FAR + 4) })
  return list
}

function Rig() {
  const desired = useMemo(() => new THREE.Vector3(), [])
  const lookTarget = useMemo(() => new THREE.Vector3(), [])
  const dolly = useMemo(() => new THREE.Vector3(), [])
  const lookCur = useRef(new THREE.Vector3(0, 1.5, 0))
  const posCur = useRef(new THREE.Vector3(-1.7, 1.66, 7.4))
  const fill = useRef<THREE.PointLight>(null!)
  const started = useRef(false)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const a = ANCHORS
    if (a.length < 2) return
    const y = typeof window !== 'undefined' ? window.scrollY : 0
    // 現在のスクロールが入る区間を探す
    let i = 0
    while (i < a.length - 2 && y > a[i + 1].atY) i++
    const span = Math.max(1, a[i + 1].atY - a[i].atY)
    const raw = Math.min(1, Math.max(0, (y - a[i].atY) / span))
    const e = raw * raw * (3 - 2 * raw)
    desired.lerpVectors(a[i].pos, a[i + 1].pos, e)
    lookTarget.lerpVectors(a[i].look, a[i + 1].look, e)
    // 縦画面: 視線方向に沿ってカメラを少し引き、横の見切れを抑える
    if (PORTRAIT) {
      dolly.copy(desired).sub(lookTarget)
      const len = dolly.length()
      if (len > 0.001) desired.addScaledVector(dolly.multiplyScalar(1 / len), 2.4)
      desired.y += 0.25
    }
    desired.x += state.pointer.x * 0.3
    desired.y += Math.sin(t * 0.4) * 0.02 + state.pointer.y * 0.09
    if (!started.current) {
      posCur.current.copy(desired)
      lookCur.current.copy(lookTarget)
      started.current = true
    }
    posCur.current.lerp(desired, 0.1)
    lookCur.current.lerp(lookTarget, 0.12)
    state.camera.position.copy(posCur.current)
    state.camera.lookAt(lookCur.current)
    if (fill.current) fill.current.position.set(posCur.current.x, posCur.current.y + 0.8, posCur.current.z - 0.6)
    // 大部屋に入るとフォグを晴らして作品をきれいに見せる(暗い通路はそのまま)
    const fog = state.scene.fog as THREE.Fog | null
    if (fog) {
      const hall = Math.min(1, Math.max(0, (-posCur.current.z - 66) / (94 - 66)))
      fog.far = 38 + hall * 58
      fog.near = 9 + hall * 9
    }
  })
  return <pointLight ref={fill} intensity={12} distance={9} decay={1.4} color="#efe6d4" />
}

function Scene() {
  return (
    <>
      {/* ローポリを暗さで隠す: フォグを手前に寄せ、環境光は弱く、スポット主体の陰影に */}
      <fog attach="fog" args={['#070609', 9, 38]} />
      <ambientLight intensity={0.24} />
      <hemisphereLight args={['#3a352c', '#070608', 0.34]} />
      <directionalLight position={[3, 3.6, 8]} intensity={0.28} color="#ded8ca" />

      {/* 廊下の壁・天井 — 大部屋の入口(HALL_MOUTH)まで延ばし、アートが並ぶ通路にする */}
      <mesh position={[-WALL_X, 2.4, (21 + HALL_MOUTH) / 2]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[21 - HALL_MOUTH, 8]} />
        <meshStandardMaterial color="#241f1b" roughness={1} />
      </mesh>
      <mesh position={[WALL_X, 2.4, (21 + HALL_MOUTH) / 2]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[21 - HALL_MOUTH, 8]} />
        <meshStandardMaterial color="#201c18" roughness={1} />
      </mesh>
      <mesh position={[0, 4.35, (21 + HALL_MOUTH) / 2]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[WALL_X * 2, 21 - HALL_MOUTH]} />
        <meshStandardMaterial color="#0d0c0b" roughness={1} />
      </mesh>

      {/* 廊下から広間まで続く反射床 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -58]}>
        <planeGeometry args={[HALL_HALF * 2 + 2, 170]} />
        <MeshReflectorMaterial
          blur={[300, 100]}
          resolution={SMALL_SCREEN ? 128 : 256}
          mixBlur={1}
          mixStrength={13}
          roughness={0.93}
          depthScale={1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#0b0b0c"
          metalness={0.5}
        />
      </mesh>

      {HERO_ART.map(([idx, z], k) => (
        <CorridorArt key={`a${k}`} idx={idx} z={z} scale={1.35} />
      ))}
      {APPROACH_ART.map(([idx, z, side], k) => (
        <CorridorArt key={`ap${k}`} idx={idx} z={z} side={side} scale={1.15} />
      ))}
      {PANELS.map((p) => (
        <Panel key={p.n} p={p} />
      ))}
      <Hall />
      <Dust />
      <Rig />
      <ViewAdaptor />
    </>
  )
}

export default function HeroScene() {
  const [hud, setHud] = useState<Hud | null>(null)
  const [hudOn, setHudOn] = useState(false)

  useEffect(() => {
    const recompute = () => {
      const features = document.getElementById('features')
      const pricing = document.getElementById('pricing')
      const closing = document.getElementById('closing')
      const footer = document.querySelector('footer') as HTMLElement | null
      const vh = window.innerHeight || 1
      const corEnd = features ? features.offsetTop + features.offsetHeight - vh : vh * 7
      const closeTop = closing ? closing.offsetTop - vh * 0.5 : corEnd + vh * 4
      // 大部屋が現れ始める位置を Pricing まで手前に(暗闇区間を短縮)
      const revealTop = pricing ? pricing.offsetTop - vh * 0.4 : closeTop
      const footTop = footer ? footer.offsetTop - vh * 0.5 : closeTop + vh
      ANCHORS = buildAnchors(corEnd, revealTop, footTop)
      return { corEnd, revealTop, closeTop, footTop, vh }
    }
    let dims = recompute()

    const walkLen = HERO_ART.length + PANELS.length
    const onScroll = () => {
      const y = window.scrollY
      const walkSpan = dims.corEnd * 0.82
      if (y < walkSpan) {
        const idx = Math.min(walkLen - 1, Math.max(0, Math.round((y / Math.max(1, walkSpan)) * (walkLen - 1))))
        setHud(CORRIDOR_HUD[idx])
        setHudOn(y > dims.vh * 0.55)
      } else {
        setHudOn(false) // 通路〜大部屋は見出しを出さない(作品を主役に)
      }
    }
    const onResize = () => {
      dims = recompute()
      onScroll()
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div className="hero-canvas" aria-hidden="true">
      <Canvas
        frameloop="always"
        dpr={[1, SMALL_SCREEN ? 1.25 : 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 48, position: [-1.7, 1.66, 7.4], near: 0.1, far: 160 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.3
        }}
      >
        <Scene />
      </Canvas>
      <div className="hero-grade" aria-hidden="true" />
      <div className={`journey-hud${hudOn ? ' on' : ''}`}>
        <div className="journey-hud-inner" key={(hud?.eyebrow || '') + (hud?.title || '')}>
          <span className="journey-hud-eyebrow">{hud?.eyebrow}</span>
          <p className="journey-hud-title">{hud?.title}</p>
        </div>
      </div>
    </div>
  )
}
