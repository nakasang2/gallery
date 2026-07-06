import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { N8AOPass } from 'n8ao'
import { ARTWORKS, renderArtworkCanvas } from './artworks.js'

/* ================= 基本セットアップ ================= */

const ROOM = { hw: 13, hd: 8, h: 5.2 } // 半幅 / 半奥行 / 高さ
const EYE = 1.6
// タッチ端末はポストプロセスを切り、影の解像度を落として30fpsを守る
const LOW_POWER = window.matchMedia('(pointer: coarse)').matches

const canvas = document.getElementById('stage')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW_POWER ? 1.5 : 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
// シーンは静的なので影は一度だけ焼く(起動後の描画コストはゼロ)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.shadowMap.autoUpdate = false

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b0a09)
scene.fog = new THREE.FogExp2(0x0b0a09, 0.016)

// 環境マップ: 床のツヤや額縁の金属部分に室内の光がうっすら映り込む
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.3
pmrem.dispose()

// 入場位置: 南東の角からタイトルウォール(西面)を望む
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
camera.rotation.order = 'YXZ'
camera.position.set(8.5, EYE, 4.5)

/* ================= 部屋 ================= */

const room = new THREE.Group()
scene.add(room)

/* ---- テクスチャ ---- */

const texLoader = new THREE.TextureLoader()
function loadTex(url, { srgb = false, repeat = null } = {}) {
  const t = texLoader.load(url)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (repeat) t.repeat.set(repeat[0], repeat[1])
  t.anisotropy = 8
  return t
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
  // 大きめの薄い塗りムラ
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

function makeWallMat(color, repeatX) {
  const bump = plasterBump.clone()
  bump.repeat.set(repeatX, repeatX * (ROOM.h / (ROOM.hw * 2)) * 2)
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    bumpMap: bump,
    bumpScale: 0.5,
    envMapIntensity: 0.25,
  })
}

const wallMat = makeWallMat(0xd8d2c6, 8)
const sideWallMat = makeWallMat(0xd8d2c6, 5)
const accentWallMat = makeWallMat(0x2b2620, 5)

const floorRepeat = [4.9, 6]
const floorMat = new THREE.MeshPhysicalMaterial({
  map: loadTex('/textures/hardwood2_diffuse.jpg', { srgb: true, repeat: floorRepeat }),
  bumpMap: loadTex('/textures/hardwood2_bump.jpg', { repeat: floorRepeat }),
  bumpScale: 0.5,
  roughnessMap: loadTex('/textures/hardwood2_roughness.jpg', { repeat: floorRepeat }),
  roughness: 0.85,
  clearcoat: 0.45,
  clearcoatRoughness: 0.35,
  envMapIntensity: 1.1,
})
const ceilMat = new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 0.95 })

const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.hw * 2, ROOM.hd * 2), floorMat)
floor.rotation.x = -Math.PI / 2
floor.userData.floor = true
floor.receiveShadow = true
room.add(floor)

const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.hw * 2, ROOM.hd * 2), ceilMat)
ceiling.rotation.x = Math.PI / 2
ceiling.position.y = ROOM.h
room.add(ceiling)

function makeWall(w, mat) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM.h), mat)
  m.receiveShadow = true
  return m
}
const north = makeWall(ROOM.hw * 2, wallMat)
north.position.set(0, ROOM.h / 2, -ROOM.hd)
const south = makeWall(ROOM.hw * 2, wallMat)
south.position.set(0, ROOM.h / 2, ROOM.hd)
south.rotation.y = Math.PI
const east = makeWall(ROOM.hd * 2, sideWallMat)
east.position.set(ROOM.hw, ROOM.h / 2, 0)
east.rotation.y = -Math.PI / 2
const west = makeWall(ROOM.hd * 2, accentWallMat)
west.position.set(-ROOM.hw, ROOM.h / 2, 0)
west.rotation.y = Math.PI / 2
room.add(north, south, east, west)

// 幅木(壁の足元の黒い帯)
const baseMat = new THREE.MeshStandardMaterial({ color: 0x0e0c0a, roughness: 0.6 })
function baseboard(w, x, z, rotY) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.04), baseMat)
  m.position.set(x, 0.06, z)
  m.rotation.y = rotY
  room.add(m)
}
baseboard(ROOM.hw * 2, 0, -ROOM.hd + 0.02, 0)
baseboard(ROOM.hw * 2, 0, ROOM.hd - 0.02, 0)
baseboard(ROOM.hd * 2, ROOM.hw - 0.02, 0, Math.PI / 2)
baseboard(ROOM.hd * 2, -ROOM.hw + 0.02, 0, Math.PI / 2)

// 廻り縁(天井際の見切り)
function crown(w, x, z, rotY) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 0.07), baseMat)
  m.position.set(x, ROOM.h - 0.09, z)
  m.rotation.y = rotY
  room.add(m)
}
crown(ROOM.hw * 2, 0, -ROOM.hd + 0.035, 0)
crown(ROOM.hw * 2, 0, ROOM.hd - 0.035, 0)
crown(ROOM.hd * 2, ROOM.hw - 0.035, 0, Math.PI / 2)
crown(ROOM.hd * 2, -ROOM.hw + 0.035, 0, Math.PI / 2)

// 天井の間接照明ライン(HDRで発光させてブルームに乗せる)
const stripMat = new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: 0xfff0d8,
  emissiveIntensity: 2.4,
})
for (const z of [-4, 0, 4]) {
  const strip = new THREE.Mesh(new THREE.BoxGeometry(ROOM.hw * 1.6, 0.02, 0.09), stripMat)
  strip.position.set(0, ROOM.h - 0.02, z)
  room.add(strip)
}

// ベンチ
const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.7 })
const benches = []
function bench(x, z) {
  const g = new THREE.Group()
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.09, 0.55), woodMat)
  top.position.y = 0.44
  const legGeo = new THREE.BoxGeometry(0.08, 0.44, 0.45)
  const leg1 = new THREE.Mesh(legGeo, baseMat)
  leg1.position.set(-0.85, 0.22, 0)
  const leg2 = new THREE.Mesh(legGeo, baseMat)
  leg2.position.set(0.85, 0.22, 0)
  for (const m of [top, leg1, leg2]) {
    m.castShadow = true
    m.receiveShadow = true
  }
  g.add(top, leg1, leg2)
  g.position.set(x, 0, z)
  room.add(g)
  benches.push({ x, z, hw: 1.25, hd: 0.5 })
}
bench(-6.5, 0)
bench(6.5, 0)

/* ================= タイトルウォール(西面) ================= */

function makeTitleWall() {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 1024
  const ctx = c.getContext('2d')
  ctx.textAlign = 'center'
  ctx.fillStyle = '#d4a24e'
  ctx.font = '500 40px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText('P E R M A N E N T   E X H I B I T I O N', 1024, 210)
  ctx.fillStyle = '#ece7de'
  ctx.font = '500 190px "Shippori Mincho", serif'
  ctx.fillText('HAKONIWA', 1024, 450)
  ctx.font = '500 74px "Shippori Mincho", serif'
  ctx.fillText('― 10人の作家による常設展 ―', 1024, 600)
  ctx.fillStyle = '#9a938a'
  ctx.font = '300 44px "Zen Kaku Gothic New", sans-serif'
  ctx.fillText('タイムラインで流れて消える一枚を、歩いて出会う一枚へ。', 1024, 750)
  ctx.fillText('ここは、あなたの箱庭になる予定の場所です。', 1024, 830)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(9.6, 4.8),
    // ライティングに馴染むようスポットライトの光を受けるマテリアルにする
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9 })
  )
  mesh.position.set(-ROOM.hw + 0.03, 2.55, 0)
  mesh.rotation.y = Math.PI / 2
  room.add(mesh)
}

/* ================= 作品の展示 ================= */

// 展示位置: 壁ごとの [x, z, 向き(rotY)]
const SLOTS = [
  // 北面 4点
  { pos: [-9.4, -ROOM.hd + 0.05], rotY: 0 },
  { pos: [-3.2, -ROOM.hd + 0.05], rotY: 0 },
  { pos: [3.2, -ROOM.hd + 0.05], rotY: 0 },
  { pos: [9.4, -ROOM.hd + 0.05], rotY: 0 },
  // 南面 4点
  { pos: [9.4, ROOM.hd - 0.05], rotY: Math.PI },
  { pos: [3.2, ROOM.hd - 0.05], rotY: Math.PI },
  { pos: [-3.2, ROOM.hd - 0.05], rotY: Math.PI },
  { pos: [-9.4, ROOM.hd - 0.05], rotY: Math.PI },
  // 東面 2点
  { pos: [ROOM.hw - 0.05, -4], rotY: -Math.PI / 2, side: true },
  { pos: [ROOM.hw - 0.05, 4], rotY: -Math.PI / 2, side: true },
]

const frameMat = new THREE.MeshStandardMaterial({
  color: 0x141210,
  roughness: 0.35,
  metalness: 0.4,
  envMapIntensity: 0.9,
})
const matBoardMat = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.9 })

// 面取り付きの額縁(中央をくり抜いた枠をベベル付きで押し出す)
function makeFrameGeo(w, h) {
  const outerW = w / 2 + 0.15
  const outerH = h / 2 + 0.15
  const innerW = w / 2 + 0.08
  const innerH = h / 2 + 0.08
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
const clickables = []
const exhibits = [] // { art, group, center, normal, width, height }

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
  ctx.fillText(art.tags.join(' ・ '), 42, 244)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.246),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })
  )
  return mesh
}

function placeArtworks() {
  ARTWORKS.forEach((art, i) => {
    const slot = SLOTS[i]
    const [rw, rh] = art.ratio
    const height = rw >= rh ? 1.3 : 1.6
    const width = (height * rw) / rh

    const tex = new THREE.CanvasTexture(renderArtworkCanvas(art, 1024))
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8

    const group = new THREE.Group()

    const frame = new THREE.Mesh(makeFrameGeo(width, height), frameMat)
    frame.position.z = 0.02
    frame.castShadow = true
    const matBoard = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.18, height + 0.18), matBoardMat)
    matBoard.position.z = 0.035
    const artMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, envMapIntensity: 0.4 })
    )
    artMesh.position.z = 0.04
    artMesh.userData.exhibitIndex = i
    group.add(frame, matBoard, artMesh)

    // 銘板(作品の右横)
    const plaque = makePlaque(art, i)
    plaque.position.set(width / 2 + 0.5, -height / 2 + 0.28, 0.02)
    group.add(plaque)

    const [x, z] = slot.pos
    group.position.set(x, 1.62, z)
    group.rotation.y = slot.rotY
    room.add(group)

    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotY)
    clickables.push(artMesh)
    exhibits.push({ art, group, center: group.position.clone(), normal, width, height, index: i })

    // スポットライト(額縁が壁に落とす影も焼き込む)
    const spot = new THREE.SpotLight(0xffe9c4, 21, 0, 0.46, 0.65, 1.1)
    const lightPos = group.position.clone().add(normal.clone().multiplyScalar(2.1))
    lightPos.y = ROOM.h - 0.15
    spot.position.copy(lightPos)
    spot.target = group
    spot.castShadow = true
    spot.shadow.mapSize.setScalar(LOW_POWER ? 512 : 1024)
    spot.shadow.bias = -0.0003
    spot.shadow.camera.near = 0.5
    room.add(spot)

    // 照明器具(見た目だけ)
    const fixture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.075, 0.22, 12),
      new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.5 })
    )
    fixture.position.copy(lightPos)
    fixture.position.y = ROOM.h - 0.11
    const dir = group.position.clone().setY(1.62).sub(lightPos).normalize()
    fixture.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
    room.add(fixture)
  })
}

/* ================= 照明(全体) ================= */

// 環境光は控えめにして、影とスポットライトのコントラストを立たせる
scene.add(new THREE.AmbientLight(0xfff4e0, 0.32))
const hemi = new THREE.HemisphereLight(0xfff8ea, 0x4a4136, 0.55)
scene.add(hemi)

// 部屋の中ほどのダウンライト(ベンチの接地影を落とす)
for (const x of [-6.5, 6.5]) {
  const down = new THREE.SpotLight(0xffedd2, 16, 0, 1.05, 0.9, 1.6)
  down.position.set(x, ROOM.h - 0.1, 0)
  const target = new THREE.Object3D()
  target.position.set(x, 0, 0)
  scene.add(target)
  down.target = target
  down.castShadow = true
  down.shadow.mapSize.setScalar(1024)
  down.shadow.bias = -0.0003
  down.shadow.camera.near = 0.5
  scene.add(down)
}

// タイトルウォールを照らす
const titleSpot = new THREE.SpotLight(0xffe9c4, 30, 0, 0.75, 0.7, 1.1)
titleSpot.position.set(-ROOM.hw + 3.4, ROOM.h - 0.2, 0)
const titleTarget = new THREE.Object3D()
titleTarget.position.set(-ROOM.hw, 2.5, 0)
scene.add(titleTarget)
titleSpot.target = titleTarget
scene.add(titleSpot)

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
  // 丸くぼかしたスプライト(四角いピクセルにならないように)
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
  const points = new THREE.Points(geo, mat)
  scene.add(points)
  return points
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
  // ベンチには乗らない
  for (const b of benches) {
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
    // ホバーでカーソル変更
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
  const floorHit = raycastAt(e.clientX, e.clientY, [floor])
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
  const k = e.key.toLowerCase()
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    state.keys.add(k)
    cancelTweens()
    closePanel()
    fadeHint()
  }
  if (k === 'escape') closePanel()
})
window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()))

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

  // 壁に正対する向き
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

/* ================= パネル / HUD ================= */

const panel = document.getElementById('panel')
const hint = document.getElementById('hint')
let hintTimer = setTimeout(() => hint.classList.add('faded'), 9000)
function fadeHint() {
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => hint.classList.add('faded'), 4000)
}

function openPanel(i) {
  const art = ARTWORKS[i]
  document.getElementById('panel-no').textContent = `No. ${String(i + 1).padStart(2, '0')}`
  document.getElementById('panel-title').textContent = art.title
  document.getElementById('panel-artist').textContent = `${art.artist} — ${art.year}`
  document.getElementById('panel-desc').textContent = art.desc
  document.getElementById('panel-tags').innerHTML = art.tags
    .map((t) => `<span>${t}</span>`)
    .join('')
  panel.classList.add('open')
  panel.setAttribute('aria-hidden', 'false')
}
function closePanel() {
  if (!panel.classList.contains('open')) return
  panel.classList.remove('open')
  panel.setAttribute('aria-hidden', 'true')
  state.focused = -1
}
document.getElementById('panel-close').addEventListener('click', closePanel)

/* ================= メインループ ================= */

let dust
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

  // キー移動
  const forward = (state.keys.has('w') || state.keys.has('arrowup') ? 1 : 0) -
    (state.keys.has('s') || state.keys.has('arrowdown') ? 1 : 0)
  const strafe = (state.keys.has('d') || state.keys.has('arrowright') ? 1 : 0) -
    (state.keys.has('a') || state.keys.has('arrowleft') ? 1 : 0)
  if (forward || strafe) {
    const dir = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw))
    const right = new THREE.Vector3(-dir.z, 0, dir.x)
    const move = dir.multiplyScalar(forward).add(right.multiplyScalar(strafe)).normalize()
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
window.__hakoniwa = { camera, state, get exhibits() { return exhibits }, get clickables() { return clickables }, raycastAt, focusExhibit }

async function start() {
  // canvasに文字を描くのでフォントの読み込みを待つ(最大1.5秒)
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))])
  makeTitleWall()
  placeArtworks()
  dust = makeDust()
  renderer.shadowMap.needsUpdate = true // 静的な影をここで一度だけ焼く
  animate()
  setTimeout(() => document.getElementById('loading').classList.add('done'), 500)
}
start()
