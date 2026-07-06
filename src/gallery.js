import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { N8AOPass } from 'n8ao'
import { ARTWORKS, renderArtworkCanvas } from './artworks.js'
import { THEMES, LAYOUTS, FRAMES, loadSettings, saveSettings } from './config.js'

/* ================= 基本セットアップ ================= */

const EYE = 1.6
const CEIL_H = 5.2
// タッチ端末はポストプロセスを切り、影の解像度を落として30fpsを守る
const LOW_POWER = window.matchMedia('(pointer: coarse)').matches

const canvas = document.getElementById('stage')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW_POWER ? 1.5 : 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
// シーンは静的なので影は再構築のたびに一度だけ焼く(以後の描画コストはゼロ)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.shadowMap.autoUpdate = false

const scene = new THREE.Scene()

// 環境マップ: 床のツヤや額縁の金属部分に室内の光がうっすら映り込む
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.3
pmrem.dispose()

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
camera.rotation.order = 'YXZ'

/* ================= 設定と可変状態 ================= */

const settings = loadSettings()

let ROOM = { hw: 13, hd: 8, h: CEIL_H } // 現在のレイアウトの部屋サイズ
let world = null // テーマ/レイアウト依存のオブジェクトを全て入れるグループ
let floorMesh = null
let dust = null
const solids = [] // 歩行の当たり判定(ベンチ・中央壁) { x, z, hw, hd }
const clickables = []
const exhibits = [] // { art, group, center, normal, width, height, index }

/* ================= 共有テクスチャ資産 ================= */

const texLoader = new THREE.TextureLoader()
const FLOOR_SRC = {
  map: '/textures/hardwood2_diffuse.jpg',
  bumpMap: '/textures/hardwood2_bump.jpg',
  roughnessMap: '/textures/hardwood2_roughness.jpg',
}
const floorBase = {}
for (const [key, url] of Object.entries(FLOOR_SRC)) {
  const t = texLoader.load(url)
  if (key === 'map') t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  floorBase[key] = t
}

// 漆喰のざらつき(手続き生成のバンプマップ — 外部素材不要)
function makePlasterBump(size = 512) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, size, size)
  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 30
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 30 + Math.random() * 90
    const v = Math.random() > 0.5 ? 255 : 0
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${v},${v},${v},0.05)`)
    g.addColorStop(1, 'rgba(128,128,128,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}
const plasterBump = makePlasterBump()

// 作品テクスチャは再構築をまたいで使い回す(デモ作品は生成、出展作品は画像から)
const artTexCache = new Map()
function getArtTexture(art) {
  const key = art.src || art.id
  if (artTexCache.has(key)) return artTexCache.get(key)
  let tex
  if (art.src) {
    tex = texLoader.load(art.src)
  } else {
    tex = new THREE.CanvasTexture(renderArtworkCanvas(art, 1024))
  }
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  artTexCache.set(key, tex)
  return tex
}
const persistentTextures = () => new Set([...Object.values(floorBase), ...artTexCache.values(), plasterBump])

/* ================= 展示リスト ================= */

function currentExhibitionList() {
  const layout = LAYOUTS[settings.layout]
  const list = [...settings.artworks, ...(settings.showDemo ? ARTWORKS : [])]
  return list.slice(0, layout.slots.length)
}
function overflowCount() {
  const layout = LAYOUTS[settings.layout]
  const total = settings.artworks.length + (settings.showDemo ? ARTWORKS.length : 0)
  return Math.max(0, total - layout.slots.length)
}
function frameKeyFor(art) {
  return settings.frameOverrides[art.id] && FRAMES[settings.frameOverrides[art.id]]
    ? settings.frameOverrides[art.id]
    : settings.frame
}

/* ================= シーン構築 ================= */

function disposeWorld() {
  if (!world) return
  const keep = persistentTextures()
  world.traverse((obj) => {
    if (obj.isLight) obj.dispose?.()
    if (obj.geometry) obj.geometry.dispose()
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
    for (const m of mats) {
      for (const slot of ['map', 'bumpMap', 'roughnessMap']) {
        if (m[slot] && !keep.has(m[slot])) m[slot].dispose()
      }
      m.dispose()
    }
  })
  scene.remove(world)
  world = null
}

function buildWorld() {
  disposeWorld()
  const theme = THEMES[settings.theme]
  const layout = LAYOUTS[settings.layout]
  ROOM = { hw: layout.hw, hd: layout.hd, h: CEIL_H }
  solids.length = 0
  clickables.length = 0
  exhibits.length = 0

  scene.background = new THREE.Color(theme.fog)
  scene.fog = new THREE.FogExp2(theme.fog, 0.016)

  world = new THREE.Group()
  scene.add(world)

  /* ---- 床・天井・壁 ---- */

  function wallMaterial(color, widthM) {
    const bump = plasterBump.clone()
    bump.repeat.set(widthM / 3.2, ROOM.h / 3.2)
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.95,
      bumpMap: bump,
      bumpScale: 0.5,
      envMapIntensity: 0.25,
    })
  }

  const floorTex = {}
  for (const [key, t] of Object.entries(floorBase)) {
    const c = t.clone()
    // 板目の実寸を保つ(1タイルあたり約5.3m × 2.7m)
    c.repeat.set((ROOM.hw * 2) / 5.3, (ROOM.hd * 2) / 2.66)
    floorTex[key] = c
  }
  const floorMat = new THREE.MeshPhysicalMaterial({
    ...floorTex,
    color: theme.floorTint,
    bumpScale: 0.5,
    roughness: 0.85,
    clearcoat: 0.45,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.1,
  })

  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.hw * 2, ROOM.hd * 2), floorMat)
  floorMesh.rotation.x = -Math.PI / 2
  floorMesh.receiveShadow = true
  world.add(floorMesh)

  const ceilMat = new THREE.MeshStandardMaterial({ color: theme.ceiling, roughness: 0.95 })
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.hw * 2, ROOM.hd * 2), ceilMat)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = ROOM.h
  world.add(ceiling)

  function addWall(w, mat, x, z, rotY) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM.h), mat)
    m.position.set(x, ROOM.h / 2, z)
    m.rotation.y = rotY
    m.receiveShadow = true
    world.add(m)
  }
  const longWallMat = wallMaterial(theme.wall, ROOM.hw * 2)
  const sideWallMat = wallMaterial(theme.wall, ROOM.hd * 2)
  const accentWallMat = wallMaterial(theme.accentWall, ROOM.hd * 2)
  addWall(ROOM.hw * 2, longWallMat, 0, -ROOM.hd, 0)
  addWall(ROOM.hw * 2, longWallMat, 0, ROOM.hd, Math.PI)
  addWall(ROOM.hd * 2, sideWallMat, ROOM.hw, 0, -Math.PI / 2)
  addWall(ROOM.hd * 2, accentWallMat, -ROOM.hw, 0, Math.PI / 2) // タイトルウォール

  /* ---- 巾木と廻り縁 ---- */

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0e0c0a, roughness: 0.6 })
  function trim(w, x, z, rotY, y, h, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trimMat)
    m.position.set(x, y, z)
    m.rotation.y = rotY
    world.add(m)
  }
  for (const [w, x, z, rotY] of [
    [ROOM.hw * 2, 0, -ROOM.hd + 0.02, 0],
    [ROOM.hw * 2, 0, ROOM.hd - 0.02, 0],
    [ROOM.hd * 2, ROOM.hw - 0.02, 0, Math.PI / 2],
    [ROOM.hd * 2, -ROOM.hw + 0.02, 0, Math.PI / 2],
  ]) {
    trim(w, x, z, rotY, 0.06, 0.12, 0.04) // 巾木
    trim(w, x, z, rotY, ROOM.h - 0.09, 0.18, 0.07) // 廻り縁
  }

  /* ---- 中央の自立壁(レイアウトによる) ---- */

  const partitionMat = wallMaterial(theme.accentWall, 8)
  for (const p of layout.partitions) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.t), partitionMat)
    box.position.set(p.x, p.h / 2, p.z)
    box.castShadow = true
    box.receiveShadow = true
    world.add(box)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.06, 0.06, p.t + 0.06), trimMat)
    cap.position.set(p.x, p.h + 0.03, p.z)
    world.add(cap)
    solids.push({ x: p.x, z: p.z, hw: p.w / 2 + 0.35, hd: p.t / 2 + 0.35 })
  }

  /* ---- 天井の間接照明ライン(HDRで発光させてブルームに乗せる) ---- */

  const stripMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: theme.stripColor,
    emissiveIntensity: 2.4,
  })
  const stripCount = Math.max(1, Math.floor(ROOM.hd / 2.5))
  for (let i = 0; i < stripCount; i++) {
    const z = (i - (stripCount - 1) / 2) * 4
    const strip = new THREE.Mesh(new THREE.BoxGeometry(ROOM.hw * 1.6, 0.02, 0.09), stripMat)
    strip.position.set(0, ROOM.h - 0.02, z)
    world.add(strip)
  }

  /* ---- ベンチとダウンライト ---- */

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.7 })
  for (const b of layout.benches) {
    const g = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.09, 0.55), woodMat)
    top.position.y = 0.44
    const legGeo = new THREE.BoxGeometry(0.08, 0.44, 0.45)
    const leg1 = new THREE.Mesh(legGeo, trimMat)
    leg1.position.set(-0.85, 0.22, 0)
    const leg2 = new THREE.Mesh(legGeo, trimMat)
    leg2.position.set(0.85, 0.22, 0)
    for (const m of [top, leg1, leg2]) {
      m.castShadow = true
      m.receiveShadow = true
    }
    g.add(top, leg1, leg2)
    g.position.set(b.x, 0, b.z)
    world.add(g)
    solids.push({ x: b.x, z: b.z, hw: 1.25, hd: 0.5 })

    const down = new THREE.SpotLight(theme.spotColor, 16, 0, 1.05, 0.9, 1.6)
    down.position.set(b.x, ROOM.h - 0.1, b.z)
    const target = new THREE.Object3D()
    target.position.set(b.x, 0, b.z)
    world.add(target)
    down.target = target
    down.castShadow = true
    down.shadow.mapSize.setScalar(1024)
    down.shadow.bias = -0.0003
    down.shadow.camera.near = 0.5
    world.add(down)
  }

  /* ---- 全体照明 ---- */

  world.add(new THREE.AmbientLight(0xfff4e0, theme.ambient))
  world.add(new THREE.HemisphereLight(0xfff8ea, 0x4a4136, theme.hemi))

  /* ---- タイトルウォール(西面) ---- */

  makeTitleWall(theme)

  /* ---- 作品 ---- */

  placeArtworks(theme, layout)

  /* ---- 漂う塵 ---- */

  dust = makeDust()
  world.add(dust)

  renderer.shadowMap.needsUpdate = true // 静的な影をここで一度だけ焼く
}

function makeTitleWall(theme) {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 1024
  const ctx = c.getContext('2d')
  const dark = theme.titleInk === 'dark'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#d4a24e'
  ctx.font = '500 40px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText('P E R M A N E N T   E X H I B I T I O N', 1024, 210)
  ctx.fillStyle = dark ? '#22201c' : '#ece7de'
  ctx.font = '500 190px "Shippori Mincho", serif'
  ctx.fillText('HAKONIWA', 1024, 450)
  ctx.font = '500 74px "Shippori Mincho", serif'
  ctx.fillText('― 10人の作家による常設展 ―', 1024, 600)
  ctx.fillStyle = dark ? '#6b665e' : '#9a938a'
  ctx.font = '300 44px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText('タイムラインで流れて消える一枚を、歩いて出会う一枚へ。', 1024, 750)
  ctx.fillText('ここは、あなたの箱庭になる予定の場所です。', 1024, 830)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const w = Math.min(9.6, ROOM.hd * 2 - 1.4)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, w / 2),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9 })
  )
  mesh.position.set(-ROOM.hw + 0.03, 2.55, 0)
  mesh.rotation.y = Math.PI / 2
  world.add(mesh)

  const titleSpot = new THREE.SpotLight(theme.spotColor, 30, 0, 0.75, 0.7, 1.1)
  titleSpot.position.set(-ROOM.hw + 3.4, ROOM.h - 0.2, 0)
  const titleTarget = new THREE.Object3D()
  titleTarget.position.set(-ROOM.hw, 2.5, 0)
  world.add(titleTarget)
  titleSpot.target = titleTarget
  world.add(titleSpot)
}

/* ---- 額装 ---- */

// 面取り付きの額縁(中央をくり抜いた枠をベベル付きで押し出す)
function makeFrameGeo(w, h, bar, gap) {
  const outerW = w / 2 + gap + bar
  const outerH = h / 2 + gap + bar
  const innerW = w / 2 + gap
  const innerH = h / 2 + gap
  const shape = new THREE.Shape()
  shape.moveTo(-outerW, -outerH)
  shape.lineTo(outerW, -outerH)
  shape.lineTo(outerW, outerH)
  shape.lineTo(-outerW, outerH)
  shape.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-innerW, -innerH)
  hole.lineTo(-innerW, innerH)
  hole.lineTo(innerW, innerH)
  hole.lineTo(innerW, -innerH)
  hole.closePath()
  shape.holes.push(hole)
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.014,
    bevelSegments: 3,
  })
}

// 作品 + 額装ひとそろいのグループを作る。戻り値は { group, artMesh, halfW }
function buildFraming(art, width, height, frameDef) {
  const group = new THREE.Group()
  const tex = getArtTexture(art)

  if (frameDef.mat === null) {
    // キャンバス張り: 枠なしで側面に厚みだけ見せる
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x28241f, roughness: 0.8 })
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, envMapIntensity: 0.35 })
    const backMat = new THREE.MeshStandardMaterial({ color: 0x1a1713, roughness: 0.9 })
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 0.05),
      [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, backMat]
    )
    box.position.z = 0.028
    box.castShadow = true
    group.add(box)
    return { group, artMesh: box, halfW: width / 2 }
  }

  const frameMat = new THREE.MeshStandardMaterial({
    color: frameDef.color,
    roughness: frameDef.roughness,
    metalness: frameDef.metalness,
    envMapIntensity: 0.9,
  })
  const frame = new THREE.Mesh(makeFrameGeo(width, height, frameDef.bar, frameDef.gap), frameMat)
  frame.position.z = 0.02
  frame.castShadow = true
  const matBoardMat = new THREE.MeshStandardMaterial({ color: frameDef.mat, roughness: 0.9 })
  const matBoard = new THREE.Mesh(
    new THREE.PlaneGeometry(width + frameDef.gap * 2 + 0.02, height + frameDef.gap * 2 + 0.02),
    matBoardMat
  )
  matBoard.position.z = 0.035
  const artMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, envMapIntensity: 0.4 })
  )
  artMesh.position.z = 0.04
  group.add(frame, matBoard, artMesh)
  return { group, artMesh, halfW: width / 2 + frameDef.gap + frameDef.bar }
}

function makePlaque(art, index) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 300
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#efece4'
  ctx.fillRect(0, 0, 512, 300)
  ctx.fillStyle = '#b3402e'
  ctx.font = '500 26px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText(`No. ${String(index + 1).padStart(2, '0')}`, 42, 66)
  ctx.fillStyle = '#22201c'
  ctx.font = '600 44px "Shippori Mincho", serif'
  ctx.fillText(art.title, 42, 130)
  ctx.fillStyle = '#55524b'
  ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText(`${art.artist} / ${art.year}`, 42, 190)
  ctx.font = '300 24px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText((art.tags || []).join(' ・ '), 42, 244)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.246),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })
  )
}

// アスペクト比から展示サイズを決める(横長は幅、縦長は高さを基準に)
function artSize(ratio) {
  const [rw, rh] = ratio
  let height = rw >= rh ? 1.3 : 1.6
  let width = (height * rw) / rh
  if (width > 2.6) {
    // 極端なパノラマは幅で頭打ちにする
    width = 2.6
    height = (width * rh) / rw
  }
  return { width, height }
}

function placeArtworks(theme, layout) {
  const list = currentExhibitionList()
  list.forEach((art, i) => {
    const slot = layout.slots[i]
    const { width, height } = artSize(art.ratio)
    const frameDef = FRAMES[frameKeyFor(art)]

    const { group, artMesh, halfW } = buildFraming(art, width, height, frameDef)
    artMesh.userData.exhibitIndex = i

    const plaque = makePlaque(art, i)
    plaque.position.set(halfW + 0.42, -height / 2 + 0.28, 0.02)
    group.add(plaque)

    group.position.set(slot.x, 1.62, slot.z)
    group.rotation.y = slot.rotY
    world.add(group)

    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotY)
    clickables.push(artMesh)
    exhibits.push({ art, group, center: group.position.clone(), normal, width, height, index: i })

    // スポットライト(額縁が壁に落とす影も焼き込む)
    const spot = new THREE.SpotLight(theme.spotColor, theme.spotIntensity, 0, 0.46, 0.65, 1.1)
    const lightPos = group.position.clone().add(normal.clone().multiplyScalar(2.1))
    lightPos.y = ROOM.h - 0.15
    spot.position.copy(lightPos)
    spot.target = group
    spot.castShadow = true
    spot.shadow.mapSize.setScalar(LOW_POWER ? 512 : 1024)
    spot.shadow.bias = -0.0003
    spot.shadow.camera.near = 0.5
    world.add(spot)

    // 照明器具(見た目だけ)
    const fixture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.075, 0.22, 12),
      new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.5 })
    )
    fixture.position.copy(lightPos)
    fixture.position.y = ROOM.h - 0.11
    const dir = group.position.clone().setY(1.62).sub(lightPos).normalize()
    fixture.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
    world.add(fixture)
  })
}

/* ================= 漂う塵(空気感) ================= */

function makeDust() {
  const N = 260
  const positions = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    positions[i * 3] = (Math.random() - 0.5) * ROOM.hw * 2
    positions[i * 3 + 1] = Math.random() * ROOM.h
    positions[i * 3 + 2] = (Math.random() - 0.5) * ROOM.hd * 2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const cctx = c.getContext('2d')
  const grad = cctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,242,216,1)')
  grad.addColorStop(0.4, 'rgba(255,242,216,0.5)')
  grad.addColorStop(1, 'rgba(255,242,216,0)')
  cctx.fillStyle = grad
  cctx.fillRect(0, 0, 64, 64)
  const dustTex = new THREE.CanvasTexture(c)
  const mat = new THREE.PointsMaterial({
    map: dustTex,
    size: 0.04,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  return new THREE.Points(geo, mat)
}

/* ================= 再構築 ================= */

function rebuild({ resetCamera = false } = {}) {
  stopTour()
  closePanel()
  buildWorld()
  if (resetCamera) {
    const entry = LAYOUTS[settings.layout].entry
    camera.position.set(entry.x, EYE, entry.z)
    state.yaw = entry.yaw
    state.pitch = 0
  }
  clampToRoom(camera.position)
}

/* ================= 操作 ================= */

const state = {
  yaw: 1.37,
  pitch: 0,
  keys: new Set(),
  vel: new THREE.Vector3(),
  dragging: false,
  dragMoved: 0,
  lastX: 0,
  lastY: 0,
  focused: -1,
  joy: { active: false, x: 0, y: 0 },
}

const tweens = []
function tween(dur, onUpdate, onDone) {
  tweens.push({ t: 0, dur, onUpdate, onDone })
}
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
function cancelTweens() {
  tweens.length = 0
}

function clampToRoom(v) {
  v.x = THREE.MathUtils.clamp(v.x, -ROOM.hw + 1.0, ROOM.hw - 1.0)
  v.z = THREE.MathUtils.clamp(v.z, -ROOM.hd + 1.0, ROOM.hd - 1.0)
  // ベンチ・中央壁には入り込まない
  for (const b of solids) {
    const inX = Math.abs(v.x - b.x) < b.hw + 0.35
    const inZ = Math.abs(v.z - b.z) < b.hd + 0.35
    if (inX && inZ) {
      const pushX = (b.hw + 0.35 - Math.abs(v.x - b.x)) * Math.sign(v.x - b.x || 1)
      const pushZ = (b.hd + 0.35 - Math.abs(v.z - b.z)) * Math.sign(v.z - b.z || 1)
      if (Math.abs(pushX) < Math.abs(pushZ)) v.x += pushX
      else v.z += pushZ
    }
  }
  return v
}

canvas.addEventListener('pointerdown', (e) => {
  stopTour()
  state.dragging = true
  state.dragMoved = 0
  state.lastX = e.clientX
  state.lastY = e.clientY
  canvas.classList.add('dragging')
  try {
    canvas.setPointerCapture(e.pointerId)
  } catch {
    // 合成イベントなどでpointerIdが無効な場合は無視
  }
})

canvas.addEventListener('pointermove', (e) => {
  if (state.dragging) {
    const dx = e.clientX - state.lastX
    const dy = e.clientY - state.lastY
    state.dragMoved += Math.abs(dx) + Math.abs(dy)
    state.lastX = e.clientX
    state.lastY = e.clientY
    state.yaw -= dx * 0.0042
    state.pitch = THREE.MathUtils.clamp(state.pitch - dy * 0.0042, -1.15, 1.15)
    fadeHint()
  } else {
    const hit = raycastAt(e.clientX, e.clientY, clickables)
    canvas.classList.toggle('pointing', !!hit)
  }
})

canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('dragging')
  if (!state.dragging) return
  state.dragging = false
  if (state.dragMoved > 8) return // ドラッグだった

  // クリック: 作品 → 鑑賞 / 床 → 移動
  const artHit = raycastAt(e.clientX, e.clientY, clickables)
  if (artHit) {
    focusExhibit(artHit.object.userData.exhibitIndex)
    return
  }
  const floorHit = raycastAt(e.clientX, e.clientY, [floorMesh])
  if (floorHit) {
    walkTo(floorHit.point)
  }
})

const raycaster = new THREE.Raycaster()
const pointerVec = new THREE.Vector2()
function raycastAt(cx, cy, objects) {
  pointerVec.x = (cx / window.innerWidth) * 2 - 1
  pointerVec.y = -(cy / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(pointerVec, camera)
  const hits = raycaster.intersectObjects(objects, false)
  return hits[0] || null
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return // 設定パネルの入力中は無視
  const k = e.key.toLowerCase()
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    state.keys.add(k)
    stopTour()
    cancelTweens()
    closePanel()
    fadeHint()
  }
  if (k === 'escape') {
    closePanel()
    closeSettings()
  }
})
window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()))

/* ---- バーチャルジョイスティック(タッチ端末) ---- */

const joyEl = document.getElementById('joy')
const joyKnob = joyEl.querySelector('.joy-knob')
const JOY_R = 44
joyEl.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  stopTour()
  cancelTweens()
  closePanel()
  fadeHint()
  state.joy.active = true
  try {
    joyEl.setPointerCapture(e.pointerId)
  } catch {
    // 合成イベントなどでpointerIdが無効な場合は無視
  }
  moveJoy(e)
})
joyEl.addEventListener('pointermove', (e) => {
  if (state.joy.active) moveJoy(e)
})
function endJoy() {
  state.joy.active = false
  state.joy.x = 0
  state.joy.y = 0
  joyKnob.style.transform = 'translate(0px, 0px)'
}
joyEl.addEventListener('pointerup', endJoy)
joyEl.addEventListener('pointercancel', endJoy)
function moveJoy(e) {
  const rect = joyEl.getBoundingClientRect()
  let dx = e.clientX - (rect.left + rect.width / 2)
  let dy = e.clientY - (rect.top + rect.height / 2)
  const len = Math.hypot(dx, dy)
  if (len > JOY_R) {
    dx = (dx / len) * JOY_R
    dy = (dy / len) * JOY_R
  }
  state.joy.x = dx / JOY_R
  state.joy.y = dy / JOY_R
  joyKnob.style.transform = `translate(${dx}px, ${dy}px)`
}

function walkTo(point) {
  cancelTweens()
  const from = camera.position.clone()
  const to = clampToRoom(new THREE.Vector3(point.x, EYE, point.z))
  const dist = from.distanceTo(to)
  if (dist < 0.3) return
  closePanel()
  fadeHint()
  tween(Math.min(2.2, 0.45 + dist * 0.22), (t) => {
    const k = easeInOut(t)
    camera.position.lerpVectors(from, to, k)
  })
}

/* ---- 作品にフォーカス ---- */

function shortestAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function focusExhibit(i) {
  const ex = exhibits[i]
  if (!ex) return
  cancelTweens()
  state.focused = i

  // 額縁ごと画面に収まる距離(縦横の大きい方に合わせる)
  const viewDist = Math.max(2.4, (ex.width + 0.3) * 2.0, (ex.height + 0.3) * 1.7)
  // 情報パネルが右側に出るので、作品が画面左寄りに見えるよう横にずらす
  const side = new THREE.Vector3(ex.normal.z, 0, -ex.normal.x)
  const shift = window.innerWidth > 700 ? viewDist * 0.2 : 0
  const to = clampToRoom(
    ex.center.clone()
      .add(ex.normal.clone().multiplyScalar(viewDist))
      .add(side.multiplyScalar(shift))
  )
  to.y = EYE
  const from = camera.position.clone()

  const targetYaw = Math.atan2(ex.normal.x, ex.normal.z)
  const targetPitch = 0
  const fromYaw = state.yaw
  const fromPitch = state.pitch
  const dYaw = shortestAngle(targetYaw - fromYaw)

  tween(
    1.15,
    (t) => {
      const k = easeInOut(t)
      camera.position.lerpVectors(from, to, k)
      state.yaw = fromYaw + dYaw * k
      state.pitch = fromPitch + (targetPitch - fromPitch) * k
    },
    () => openPanel(i)
  )
}

/* ================= 順路ツアー ================= */

const tourBtn = document.getElementById('btn-tour')
let tourActive = false
let tourIdx = 0
let tourTimer = null

function startTour() {
  if (!exhibits.length) return
  closeSettings()
  tourActive = true
  tourIdx = 0
  tourBtn.classList.add('active')
  tourBtn.textContent = '■ ツアーを止める'
  tourStep()
}
function tourStep() {
  focusExhibit(tourIdx)
  tourTimer = setTimeout(() => {
    tourIdx++
    if (tourIdx >= exhibits.length) {
      stopTour()
      return
    }
    tourStep()
  }, 6200)
}
function stopTour() {
  if (!tourActive) return
  tourActive = false
  clearTimeout(tourTimer)
  tourBtn.classList.remove('active')
  tourBtn.textContent = '▶ 順路ツアー'
}
tourBtn.addEventListener('click', () => {
  if (tourActive) stopTour()
  else startTour()
})

/* ================= 作品情報パネル ================= */

const panel = document.getElementById('panel')
const hint = document.getElementById('hint')
let hintTimer = setTimeout(() => hint.classList.add('faded'), 9000)
function fadeHint() {
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => hint.classList.add('faded'), 4000)
}

function openPanel(i) {
  const ex = exhibits[i]
  if (!ex) return
  const art = ex.art
  document.getElementById('panel-no').textContent = `No. ${String(i + 1).padStart(2, '0')}`
  document.getElementById('panel-title').textContent = art.title
  document.getElementById('panel-artist').textContent = `${art.artist} — ${art.year}`
  document.getElementById('panel-desc').textContent = art.desc || ''
  document.getElementById('panel-tags').innerHTML = (art.tags || [])
    .map((t) => `<span>${t}</span>`)
    .join('')
  renderPanelFrameChips(art)
  panel.classList.add('open')
  panel.setAttribute('aria-hidden', 'false')
}
function closePanel() {
  if (!panel.classList.contains('open')) return
  panel.classList.remove('open')
  panel.setAttribute('aria-hidden', 'true')
  state.focused = -1
}
document.getElementById('panel-close').addEventListener('click', () => {
  stopTour()
  closePanel()
})

// 鑑賞中の作品の額装をその場で変更できるチップ
function renderPanelFrameChips(art) {
  const wrap = document.getElementById('panel-frame-chips')
  const current = frameKeyFor(art)
  wrap.innerHTML = ''
  for (const [key, def] of Object.entries(FRAMES)) {
    const b = document.createElement('button')
    b.className = 'chip' + (key === current ? ' active' : '')
    b.textContent = def.label
    b.addEventListener('click', () => {
      settings.frameOverrides[art.id] = key
      persist()
      const artId = art.id
      rebuild()
      // 再構築後も同じ作品を見続ける
      const idx = exhibits.findIndex((ex) => ex.art.id === artId)
      if (idx >= 0) focusExhibit(idx)
    })
    wrap.appendChild(b)
  }
}

/* ================= 空間設定パネル ================= */

const settingsEl = document.getElementById('settings')
const settingsBtn = document.getElementById('btn-settings')

function openSettings() {
  stopTour()
  closePanel()
  renderSettingsUI()
  settingsEl.classList.add('open')
  settingsEl.setAttribute('aria-hidden', 'false')
}
function closeSettings() {
  settingsEl.classList.remove('open')
  settingsEl.setAttribute('aria-hidden', 'true')
}
settingsBtn.addEventListener('click', () => {
  if (settingsEl.classList.contains('open')) closeSettings()
  else openSettings()
})
document.getElementById('settings-close').addEventListener('click', closeSettings)

function persist() {
  if (!saveSettings(settings)) {
    alert('ブラウザの保存容量を超えました。出展作品を減らすか、小さめの画像でお試しください。')
  }
}

function chipRow(containerId, defs, currentKey, onPick) {
  const wrap = document.getElementById(containerId)
  wrap.innerHTML = ''
  for (const [key, def] of Object.entries(defs)) {
    const b = document.createElement('button')
    b.className = 'chip' + (key === currentKey ? ' active' : '')
    b.textContent = def.label
    b.addEventListener('click', () => onPick(key))
    wrap.appendChild(b)
  }
}

function renderSettingsUI() {
  chipRow('chips-theme', THEMES, settings.theme, (key) => {
    settings.theme = key
    persist()
    rebuild()
    renderSettingsUI()
  })
  chipRow('chips-layout', LAYOUTS, settings.layout, (key) => {
    settings.layout = key
    persist()
    rebuild({ resetCamera: true })
    renderSettingsUI()
  })
  chipRow('chips-frame', FRAMES, settings.frame, (key) => {
    settings.frame = key
    settings.frameOverrides = {} // 全体変更は作品ごとの指定もリセット
    persist()
    rebuild()
    renderSettingsUI()
  })

  document.getElementById('show-demo').checked = settings.showDemo

  // 出展済みの作品リスト
  const list = document.getElementById('my-works')
  list.innerHTML = ''
  for (const art of settings.artworks) {
    const li = document.createElement('li')
    const img = document.createElement('img')
    img.src = art.src
    img.alt = ''
    const span = document.createElement('span')
    span.textContent = art.title
    const del = document.createElement('button')
    del.textContent = '×'
    del.setAttribute('aria-label', `${art.title} を取り下げる`)
    del.addEventListener('click', () => {
      settings.artworks = settings.artworks.filter((a) => a.id !== art.id)
      delete settings.frameOverrides[art.id]
      persist()
      rebuild()
      renderSettingsUI()
    })
    li.append(img, span, del)
    list.appendChild(li)
  }

  const note = document.getElementById('slot-note')
  const over = overflowCount()
  const slots = LAYOUTS[settings.layout].slots.length
  if (over > 0) {
    note.hidden = false
    note.textContent = `このレイアウトの展示枠は${slots}点です。${over}点は表示されていません(レイアウト変更かデモ非表示で枠が空きます)。`
  } else {
    note.hidden = true
  }
}

document.getElementById('show-demo').addEventListener('change', (e) => {
  settings.showDemo = e.target.checked
  persist()
  rebuild()
  renderSettingsUI()
})

// Instagram連携はプロトタイプではモック(要件定義 8-2 参照)
document.getElementById('ig-connect').addEventListener('click', () => {
  const note = document.getElementById('ig-note')
  note.hidden = !note.hidden
})

/* ---- 出展(アップロード / URL) ---- */

function loadImage(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// localStorage に収まるよう長辺を抑えて JPEG 化する
async function fileToDataUrl(file, maxSide = 1280) {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff' // 透過PNG対策
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return { dataUrl: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function newArtworkEntry({ title, src, w, h }) {
  const artist = document.getElementById('art-artist').value.trim() || 'あなた'
  return {
    id: 'u' + Date.now() + Math.random().toString(36).slice(2, 6),
    title,
    artist,
    year: new Date().getFullYear(),
    desc: '',
    tags: ['出展作品'],
    ratio: [w, h],
    src,
  }
}

function addArtworks(entries) {
  settings.artworks = [...settings.artworks, ...entries]
  persist()
  rebuild()
  renderSettingsUI()
}

document.getElementById('art-file').addEventListener('change', async (e) => {
  const files = [...e.target.files]
  e.target.value = ''
  if (!files.length) return
  const titleInput = document.getElementById('art-title')
  const entries = []
  for (const file of files) {
    try {
      const { dataUrl, w, h } = await fileToDataUrl(file)
      const title = titleInput.value.trim() || file.name.replace(/\.[^.]+$/, '') || '無題'
      entries.push(newArtworkEntry({ title, src: dataUrl, w, h }))
    } catch {
      alert(`「${file.name}」を読み込めませんでした。`)
    }
  }
  titleInput.value = ''
  if (entries.length) addArtworks(entries)
})

document.getElementById('art-url-add').addEventListener('click', async () => {
  const input = document.getElementById('art-url')
  const url = input.value.trim()
  if (!url) return
  try {
    // WebGLテクスチャにはCORS許可が必要なので、ここで検証を兼ねて読み込む
    const img = await loadImage(url, true)
    const title = document.getElementById('art-title').value.trim() || '無題'
    document.getElementById('art-title').value = ''
    input.value = ''
    addArtworks([newArtworkEntry({ title, src: url, w: img.width, h: img.height })])
  } catch {
    alert('画像を読み込めませんでした。配信元がCORSを許可していない可能性があります(その場合はアップロードをご利用ください)。')
  }
})

/* ================= ポストプロセス ================= */

// AO(接地感)+ 控えめなブルーム + SMAA。タッチ端末では素のレンダリングに落とす
let composer = null
if (!LOW_POWER) {
  composer = new EffectComposer(renderer)
  const n8ao = new N8AOPass(scene, camera, window.innerWidth, window.innerHeight)
  n8ao.configuration.aoRadius = 1.2
  n8ao.configuration.distanceFalloff = 2.5
  n8ao.configuration.intensity = 2.4
  n8ao.configuration.gammaCorrection = false // 色変換は後段のOutputPassに任せる
  n8ao.setQualityMode('Medium')
  composer.addPass(n8ao)
  composer.addPass(
    new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.55, 0.85)
  )
  composer.addPass(new OutputPass())
  composer.addPass(new SMAAPass(window.innerWidth, window.innerHeight))
}

/* ================= メインループ ================= */

const timer = new THREE.Timer()

function animate() {
  requestAnimationFrame(animate)
  timer.update()
  const dt = Math.min(timer.getDelta(), 0.05)

  // トゥイーン
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i]
    tw.t += dt
    const t = Math.min(1, tw.t / tw.dur)
    tw.onUpdate(t)
    if (t >= 1) {
      tweens.splice(i, 1)
      tw.onDone && tw.onDone()
    }
  }

  // キー / ジョイスティック移動
  let forward = (state.keys.has('w') || state.keys.has('arrowup') ? 1 : 0) -
    (state.keys.has('s') || state.keys.has('arrowdown') ? 1 : 0)
  let strafe = (state.keys.has('d') || state.keys.has('arrowright') ? 1 : 0) -
    (state.keys.has('a') || state.keys.has('arrowleft') ? 1 : 0)
  if (state.joy.active) {
    forward += -state.joy.y
    strafe += state.joy.x
  }
  if (forward || strafe) {
    const dir = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw))
    const right = new THREE.Vector3(-dir.z, 0, dir.x)
    const move = dir.multiplyScalar(forward).add(right.multiplyScalar(strafe))
    if (move.lengthSq() > 1) move.normalize()
    state.vel.lerp(move.multiplyScalar(3.1), 1 - Math.pow(0.0008, dt))
  } else {
    state.vel.lerp(new THREE.Vector3(), 1 - Math.pow(0.0001, dt))
  }
  if (state.vel.lengthSq() > 1e-6) {
    camera.position.addScaledVector(state.vel, dt)
    clampToRoom(camera.position)
  }

  camera.rotation.set(state.pitch, state.yaw, 0)

  // 塵をゆっくり漂わせる
  if (dust) {
    const pos = dust.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.06
      if (y > ROOM.h) y = 0
      pos.setY(i, y)
    }
    pos.needsUpdate = true
  }

  if (composer) composer.render()
  else renderer.render(scene, camera)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  if (composer) composer.setSize(window.innerWidth, window.innerHeight)
})

/* ================= 起動 ================= */

// プロトタイプ用: コンソールから内部状態を確認できるようにしておく
window.__hakoniwa = {
  camera,
  state,
  settings,
  rebuild,
  startTour,
  stopTour,
  get exhibits() { return exhibits },
  get clickables() { return clickables },
  raycastAt,
  focusExhibit,
  openPanel,
}

async function start() {
  // canvasに文字を描くのでフォントの読み込みを待つ(最大1.5秒)
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))])
  rebuild({ resetCamera: true })
  animate()
  setTimeout(() => document.getElementById('loading').classList.add('done'), 500)
}
start()
