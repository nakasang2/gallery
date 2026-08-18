'use client'
// 3D gallery core: R3F Canvas + HUD/panels + guided tour
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor, useProgress } from '@react-three/drei'
import { resolveLayout, THEMES } from '@/lib/presets'
import { useExhibitionList } from '@/lib/exhibition'
import { demoDesignOverrides } from '@/lib/artworks'
import { useGallery } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { walkRef, canvasRef, camPose, QUALITY } from '@/lib/controller'
import { PERF } from '@/lib/perfFlags'
import { galleryAudio } from '@/lib/audio'
import { audioGuide } from '@/lib/guide'
import { unlockVideoAudio, suspendVideoAudio } from '@/lib/videohub'
import { sessionFlags, track } from '@/lib/analytics'
import GalleryScene from './GalleryScene'
import FlatGallery from './FlatGallery'
import MiniMap from './MiniMap'
import RoomSwitch from './RoomSwitch'
import { HudTop, HudActions, HudStepper, Hint } from './Hud'
import ArtworkPanel from './ArtworkPanel'
import InfoPanel from './InfoPanel'
import SettingsPanel from './SettingsPanel'
import GuestbookPanel from './GuestbookPanel'
import LoadingScreen from './LoadingScreen'
import { useT } from '@/components/I18nProvider'

// three's `fov` is the VERTICAL angle, so a portrait phone keeps the 60° height
// and pays for it in width: 390×844 sees only 29.9° horizontally where a laptop
// sees 85.5°. A visitor arriving from a shared link got a third of the room and
// a wall of floor. Below REF_ASPECT we solve for the vertical angle that holds
// the horizontal view steady, capped at MAX_FOV so a tall phone doesn't fish-eye
// the space. At and above REF_ASPECT nothing changes — desktop framing is tuned
// (docs/DECISIONS 2026-07-23) and must stay exactly as it is.
const BASE_FOV = 60
const REF_ASPECT = 1.3
const MAX_FOV = 78
const REF_HALF_TAN = Math.tan((BASE_FOV * Math.PI) / 360) * REF_ASPECT

function portraitFov(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect >= REF_ASPECT) return BASE_FOV
  const v = (2 * Math.atan(REF_HALF_TAN / aspect) * 180) / Math.PI
  return Math.min(MAX_FOV, v)
}

/** Keeps the camera's field of view honest across rotation and resize. */
function AdaptiveFov() {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    if (!cam.isPerspectiveCamera) return
    const fov = portraitFov(width / Math.max(1, height))
    if (Math.abs(cam.fov - fov) < 0.01) return
    cam.fov = fov
    cam.updateProjectionMatrix()
  }, [camera, width, height])
  return null
}

// Non-blocking notice for errors/limits hit while walking the room (see lib/toast)
function Toast() {
  const msg = useToast()
  return (
    <div className={`gallery-toast${msg ? ' show' : ''}`} role="status" aria-live="polite">
      {msg}
    </div>
  )
}

// Guided tour: focus works in order, pausing to view each before moving on.
// Live tour: hold each work at least MIN_DWELL, then wait for its narration to
// finish (MAX_DWELL ceiling so a long/stuck guide can't stall). Recording run:
// a brisk fixed dwell — the WebM captures video only, so there's no narration to
// wait for and short beats keep the shareable clip tight.
const MIN_DWELL_MS = 6200
const MAX_DWELL_MS = 30_000
const REC_DWELL_MS = 6200
function useTour() {
  const tourActive = useGallery((s) => s.tourActive)
  const count = useExhibitionList().length

  useEffect(() => {
    if (!tourActive) return
    const recording = useGallery.getState().tourRecording
    let idx = 0
    let minTimer: ReturnType<typeof setTimeout> | undefined
    let maxTimer: ReturnType<typeof setTimeout> | undefined
    let unsub: (() => void) | undefined
    useGallery.getState().setSettingsOpen(false)

    const clearStep = () => {
      if (minTimer) clearTimeout(minTimer)
      if (maxTimer) clearTimeout(maxTimer)
      unsub?.()
      unsub = undefined
    }
    const next = () => {
      clearStep()
      idx++
      if (idx >= count) {
        useGallery.getState().setTourActive(false)
        return
      }
      step()
    }
    const step = () => {
      walkRef.current?.focusExhibit(idx)
      if (recording) {
        minTimer = setTimeout(next, REC_DWELL_MS)
        return
      }
      let advanced = false
      const advance = () => {
        if (advanced) return
        advanced = true
        next()
      }
      // After the minimum dwell, move on as soon as the narration isn't playing;
      // if it's still going, wait for it to end. MAX_DWELL is the hard ceiling.
      minTimer = setTimeout(() => {
        if (!audioGuide.playing) {
          advance()
          return
        }
        unsub = audioGuide.subscribe(() => {
          if (!audioGuide.playing) advance()
        })
      }, MIN_DWELL_MS)
      maxTimer = setTimeout(advance, MAX_DWELL_MS)
    }
    step()
    return () => clearStep()
  }, [tourActive, count])
}

/**
 * シェーダの事前コンパイル。**ロード画面の裏で**シーン中の全マテリアルの GPU プログラムを
 * 作ってしまう。
 *
 * WebGL はマテリアルが**初めて画面に映る瞬間**にシェーダをコンパイルする。だから
 * 「入室直後だけ重い」が起きる ── 扉が開いたあと振り向くたび、新しい額縁や壁が視界に
 * 入るたびに数十msの停止が挟まる（ユーザー報告 2026-08-13「ロード直後重い」）。
 * `compileAsync` は `KHR_parallel_shader_compile` があればGPU側で並列に作るので、
 * 同期版よりメインスレッドを止めない。無い環境では同期版に落ちる。
 *
 * **失敗しても止めない**: コンパイルは「先にやっておく」だけの最適化で、やらなくても
 * 描画時に作られる。ここで例外を投げてロード画面に閉じ込めるほうがずっと悪い。
 */
function Warmup({ armed, onDone }: { armed: boolean; onDone: () => void }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const started = useRef(false)
  /** 打ち消すのは**アンマウントのときだけ**。別視点レビューで検出: `armed` は
   *  `assetsIdle` を含むので、コンパイル中に次の波（銘板のcanvas・動画のポスター・
   *  ゴーストのGLB）が1件登録されるだけで false へ落ちる。それを「やめる合図」に
   *  していたため、**完了の通知が捨てられ、扉が12秒のタイムアウトまで開かなかった**
   *  （しかも `gallery_loading_timeout` が誤って飛ぶので、記録の上では壊れて見える）。 */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!armed || started.current) return
    started.current = true
    const finish = () => {
      if (mounted.current) onDone()
    }
    try {
      // カメラの向きは関係なく、シーンに居るもの全部（視界の外も）を対象にする。
      gl.compileAsync(scene, camera).then(finish, finish)
    } catch {
      finish()
    }
  }, [armed, gl, scene, camera, onDone])
  return null
}

/** 扉を開ける前に、**実際のパイプラインで滑らかに描けること**を確かめる番。
 *
 *  `Warmup` の `compileAsync` が作るのは**シーンの中の材質のシェーダだけ**で、
 *  ポスト処理（N8AO/Bloom/SMAA）・反射床の内部材質・壁の影の焼き直しは**その外側**にある。
 *  何が重いかを個別に列挙するのはやめ、**「連続して速く描けた」ことを合図にする** ──
 *  原因が入れ替わっても効くし、新しい演出を足したときに列挙を忘れる余地が無い。
 *
 *  実測（2026-08-18・`/demo`・PC相当）: 扉が開いた直後に **273ms と 245ms の停止が2回**。
 *  正体は「扉が開いてから設定を2回書き換えていた」ことで、そのたびに `bakeKey` が変わり
 *  影を全部焼き直していた。書き換えを扉の手前（`preOpen`）へ移し、この番が焼き直しを
 *  待ってから開ける。
 *
 *  **上限を切ってある**ので、遅い機械でロード画面が伸び続けることはない（切れたら開ける）。
 *  隠れたタブでは rAF が止まって delta が巨大になるので数えない。 */
const SETTLE_FRAME_MS = 50 // これより遅いフレームは「停止」とみなす（20fps相当）
const SETTLE_FRAMES = 6 // 連続でこの本数を滑らかに描けたら合格（約100ms）
const SETTLE_CAP_MS = 1500 // これ以上は待たない

function SettleGate({ armed, onSettled }: { armed: boolean; onSettled: () => void }) {
  const good = useRef(0)
  const startedAt = useRef(0)
  const done = useRef(false)
  useFrame((_, delta) => {
    if (!armed || done.current) return
    if (!startedAt.current) startedAt.current = performance.now()
    if (document.hidden) return
    if (delta * 1000 < SETTLE_FRAME_MS) good.current++
    else good.current = 0
    if (good.current >= SETTLE_FRAMES || performance.now() - startedAt.current > SETTLE_CAP_MS) {
      done.current = true
      onSettled()
    }
  })
  return null
}

/** 歩いている間だけ解像度を落とし、**立ち止まったら最高画質に戻す**（`?perf=adaptive`）。
 *
 *  ギャラリーは「歩いて近づき、立ち止まって観る」もの。**観ている瞬間の解像度は落とせない**
 *  一方、**動いている間のぼやけは動いていること自体に紛れる**。実測（ユーザーのPC・
 *  2026-08-18）では、演出（反射床・N8AO・後処理）を全部切っても +2.4fps しか戻らず、
 *  **効くのは画素数だけ**（等倍 33.6fps / 通常 13.8fps）。ならば「いつ画素を使うか」を
 *  選ぶのが唯一まともな設計になる。
 *
 *  動きの判定は `camPose`（`WalkControls` が毎フレーム書くカメラの位置と向き）の差分。
 *  **戻すのは静止が続いてから**（`STILL_MS`）── 立ち止まった直後に戻すと、歩きながらの
 *  細かい停止で切り替えが連打される。落とすのは即座でよい（動いているので目立たない）。
 *
 *  **既定では無効。** 解像度の切り替えは描画バッファを作り直すため一瞬の引っかかりが
 *  出うる（このファイルの `PerformanceMonitor` に「行ったり来たりは不快だった」という
 *  記録がある）。実機で触って良ければ既定にする、というのがこの旗の目的。 */
const STILL_MS = 400 // 静止がこれだけ続いたら最高画質へ戻す
const MOVE_POS = 0.004 // 1フレームの移動量（m）がこれを超えたら「動いている」
const MOVE_YAW = 0.002 // 同・向きの変化（rad）

/** 歩行状態は**コンポーネントの外**に持つ。
 *  `dpr` を変えると R3F は Canvas を再構成するので、`useRef` に持つと**落とした直後に
 *  リセットされ、`moving` が false に戻って「戻す」側の条件（`moving && 静止が続いた`）に
 *  二度と入れない**。実際、落ちたきり戻らない症状が出た（2026-08-18）。
 *  `camPose` と同じく、React の再描画から独立した入れ物に置く。 */
const adaptive = { started: false, moving: false, since: 0, x: 0, z: 0, yaw: 0 }

function AdaptiveDpr({ onMoving }: { onMoving: (moving: boolean) => void }) {
  useFrame(() => {
    if (!adaptive.started) {
      adaptive.started = true
      adaptive.x = camPose.x
      adaptive.z = camPose.z
      adaptive.yaw = camPose.yaw
      return
    }
    const dx = camPose.x - adaptive.x
    const dz = camPose.z - adaptive.z
    const dyaw = Math.abs(camPose.yaw - adaptive.yaw)
    adaptive.x = camPose.x
    adaptive.z = camPose.z
    adaptive.yaw = camPose.yaw
    const now = performance.now()
    if (Math.hypot(dx, dz) > MOVE_POS || dyaw > MOVE_YAW) {
      adaptive.since = now
      if (!adaptive.moving) {
        adaptive.moving = true
        onMoving(true)
      }
    } else if (adaptive.moving && now - adaptive.since > STILL_MS) {
      adaptive.moving = false
      onMoving(false)
    }
  })
  return null
}

export default function GalleryApp({ onShellReady, demoTheme, demo = false }: { onShellReady?: () => void; demoTheme?: string | null; demo?: boolean }) {
  const t = useT()
  const ready = useGallery((s) => s.ready)
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)

  // The /demo house showcase populates a fixed ambient crowd (no real visit count).
  // Flag it in the store so GhostVisitors knows; clear it when leaving.
  useEffect(() => {
    useGallery.getState().setDemoMode(demo)
    return () => useGallery.getState().setDemoMode(false)
  }, [demo])
  const [loadingDone, setLoadingDone] = useState(false)
  // **扉を開ける手前の段。** 設定の書き換え（/demo のテーマと見本の適用）はここで起こす ──
  // 従来はこの時点で即 `loadingDone` にしていたため、**扉が開いた直後に設定が2回変わり、
  // そのたびに壁の影を全部焼き直していた**（PCで250msの停止が2回。2026-08-18 実測）。
  const [preOpen, setPreOpen] = useState(false)
  // 実際のパイプラインで滑らかに描けたか（`SettleGate`）
  const [settled, setSettled] = useState(false)
  // 扉を抜けて次の部屋へ向かっている最中（`enterRoom` が立てる）。フルページ遷移の
  // 「新しいドキュメントの取得中は何も描かれない」区間を、いまのページのまま
  // ロード画面で埋める（ユーザー指摘 2026-08-13）。
  const roomTransition = useGallery((s) => s.roomTransition)
  // iOS Safari drops the WebGL context aggressively — switch apps, take a call,
  // open a few tabs, and the room comes back black. There was no handler at all,
  // and the initial `webgl` probe already succeeded, so it never fell through to
  // FlatGallery either: the visitor just sat in front of nothing until they
  // thought to reload. `canvasKey` rebuilds the scene against a fresh context.
  const [canvasKey, setCanvasKey] = useState(0)
  const [contextLost, setContextLost] = useState(false)

  // 事前コンパイルが終わったか。**「ロード直後だけ重い」の正体**（ユーザー報告
  // 2026-08-13）── WebGL はマテリアルが**初めて描かれる瞬間**にシェーダを作るので、
  // 扉が開いたあと歩いて新しい物が視界に入るたびに数十msの停止が起きる。
  // `Warmup` がロード画面の裏でまとめて作ってしまう。
  const [warm, setWarm] = useState(false)
  const onWarm = useCallback(() => setWarm(true), [])
  const onSettled = useCallback(() => setSettled(true), [])

  // Settings hydrated + canvas fonts ready. Used to be the whole story, which is
  // why the door opened on a timer while the room was still empty.
  const [hydrated, setHydrated] = useState(false)
  const [waitedOut, setWaitedOut] = useState(false)
  // Every file-backed asset in the room goes through three's default loading
  // manager — artwork images (components/gallery/textures.ts `texLoader`), video
  // posters, the floor/wall maps and the ghost GLBs (useGLTF) — so this is a real
  // measure of "is the room actually there yet".
  const { active: assetsLoading, loaded: assetsLoaded, total: assetsTotal } = useProgress()
  const assetsIdle = !assetsLoading && assetsLoaded >= assetsTotal
  // 進捗は**戻さない**（ユーザー報告 2026-08-13「ロードが二回される」の正体）。
  // three の `LoadingManager` は `itemsTotal` / `itemsLoaded` を**セッション通しで数え、
  // 一度も0に戻さない**（`node_modules/three/src/loaders/LoadingManager.js` を実際に読んで
  // 確認した ── 最初は「波ごとに数え直す」と思い込んで積み上げる実装を書いたが、
  // その条件は永久に成立しない死んだコードだった）。実際に起きるのは**割合の後退**で、
  // 20/20（100%）のあとに新しい波が12件登録されると 20/32（62%）へ落ちる。バーが伸び切って
  // から戻ってまた伸びるので、待っている人からは「2回ロードしている」に見える。
  // 表示は**最大値で止める** ── 遅れている波があっても、進捗は前に進むだけにする。
  //
  // ただし**単調増加だけでは足りない**: 最初に登録された1件がほかより先に終わると
  // 1/1 = 100% になり、そこで止まったまま残りを読み続ける（バーが役に立たなくなる）。
  // そこで **92% で足止めし、本当に空になったときだけ 100%** にする。伸びるだけ・
  // 嘘の完了を出さない、の両方を満たす。
  const pctSeen = useRef(0)
  const rawPct = assetsTotal > 0 ? Math.round((Math.min(assetsLoaded, assetsTotal) / assetsTotal) * 100) : 0
  // 「今の狙い」は、**扉が開く直前なら 100**、まだ読んでいるなら生の割合（92止め）。
  // それを過去の最大と比べて大きい方にするので、後から波が増えても戻らない。
  // ※ 100 を「空になった瞬間」で出すと嘘になる: 最初の1件がほかより先に終わると
  //   1/1 = 100% でそこから動かなくなる（キャッシュが温かいと実際に起きる）。
  //   **本当に開ける条件（`hydrated` かつ事前コンパイル済みかつ空）**に揃える。
  const nearlyOpen = hydrated && warm && assetsIdle && assetsTotal > 0
  const target = nearlyOpen ? 100 : Math.min(rawPct, 92)
  const loadPct = Math.max(pctSeen.current, target)
  pctSeen.current = loadPct
  // null = still detecting; false = no WebGL → 2D list fallback
  const [webgl, setWebgl] = useState<boolean | null>(null)
  // WebGLがあっても、自分の意思でリスト表示へ切り替えられる（U3・2026-08-16）。
  // 「スクリーンリーダーが動いているか」はJSから検出できない（意図的にブラウザが
  // 隠している）ので、機能検出だけに頼らずスキップリンクで選べるようにする ──
  // 3D空間を読み上げ向けに再現するのではなく、既にある FlatGallery（等価な代替。
  // WCAG 1.1.1）へ切り替えるだけにしてある。
  const [forceFlat, setForceFlat] = useState(false)
  const flatMode = webgl === false || forceFlat
  // Render resolution per quality tier. The high tier starts at native retina and
  // steps down when PerformanceMonitor sees sustained low FPS (weak iGPU laptops).
  // 診断モード（`?perf=...`）では**解像度を固定する**。測っている最中に下の
  // `PerformanceMonitor` が dpr を下げると、前後の数字が比べられなくなるため。
  const [dpr, setDpr] = useState<[number, number]>(
    !PERF.fullDpr
      ? [1, 1]
      : QUALITY === 'high' ? [1, 2] : QUALITY === 'medium' ? [1, 1.5] : [1, 1.25]
  )
  // `?perf=adaptive`: 歩き出したら等倍、止まったら元の上限へ戻す
  const dprFull = useRef(dpr)
  const onMoving = useCallback((moving: boolean) => {
    setDpr(moving ? [1, 1] : dprFull.current)
    // 診断モードでしか呼ばれない。**いま落ちているのか戻っているのかを外から読めるようにする**
    // ── 「止まったら戻る」が本当に起きているかは、canvas の実解像度と突き合わせないと
    // 分からない（プレビューでは描画が止まるので目視では確かめられなかった）。
    document.body.dataset.perfDpr = moving ? 'low' : 'full'
  }, [])
  const dprRef = useRef(dpr)
  const entryRef = useRef(
    resolveLayout(useGallery.getState().layout, useGallery.getState().layoutParams).entry
  )

  useTour()

  // Which room this is, so entry failures can be split between a visitor's shared
  // link, the /demo showcase and an owner looking at their own space.
  const surface = demo ? 'demo' : visitor ? 'visitor' : user ? 'owner' : 'guest'
  const galleryId = visitor?.galleryId

  useEffect(() => {
    let ok = false
    try {
      const c = document.createElement('canvas')
      ok = !!(c.getContext('webgl2') || c.getContext('webgl'))
    } catch {
      ok = false
    }
    setWebgl(ok)
    // No WebGL means this visitor never sees the 3D room at all — they get the
    // flat list. Until now that happened in complete silence.
    if (!ok) track('gallery_webgl_unsupported', { surface, gallery_id: galleryId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Prototype: expose internal state on the console for inspection
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__xibit360 = { store: useGallery, walkRef }
    useGallery.getState().initAuth()
    onShellReady?.() // our own LoadingScreen has taken over from any outer fallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ambient and video audio start on first interaction due to browser autoplay limits
  useEffect(() => {
    const unlock = () => {
      galleryAudio.unlock()
      // Owner-uploaded ambient BGM (§P3-12): loop the visitor gallery's track (null on
      // /demo or a room with none). Starts here because autoplay needs a user gesture.
      galleryAudio.setBgm(useGallery.getState().visitor?.bgmUrl ?? null)
      unlockVideoAudio()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      // Leaving the gallery: silence the ambient/video audio. Their contexts are
      // module singletons that outlive this component, so the loop would otherwise
      // keep playing on the landing page / dashboard after navigating away.
      galleryAudio.suspend()
      galleryAudio.setBgm(null) // stop the looping BGM source when leaving the gallery
      suspendVideoAudio()
      audioGuide.suspend() // stop any narration when leaving the gallery
      canvasRef.current = null // the canvas is gone once we unmount
    }
  }, [])

  // Restore settings only after the canvas text fonts have loaded (up to 1.5s).
  // The extra 500ms is the minimum dwell — it also gives the scene a beat to
  // register its first loads, so `assetsIdle` below can't read the empty gap
  // between mount and the first request as "finished".
  useEffect(() => {
    let alive = true
    Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => {
      if (!alive) return
      useGallery.getState().hydrate()
      entryRef.current = resolveLayout(useGallery.getState().layout, useGallery.getState().layoutParams).entry
      setTimeout(() => alive && setHydrated(true), 500)
    })
    return () => {
      alive = false
    }
  }, [])

  // Read inside the 12s timeout below without making it a dependency (re-arming
  // that clock on every asset that lands would mean it never fires).
  const assetsLoadedRef = useRef(assetsLoaded)
  const assetsTotalRef = useRef(assetsTotal)
  assetsLoadedRef.current = assetsLoaded
  assetsTotalRef.current = assetsTotal
  const mountedAt = useRef(Date.now())

  // A stalled or missing asset must never trap a visitor behind the door.
  useEffect(() => {
    const t = setTimeout(() => {
      setWaitedOut(true)
      // We are opening the doors on a room whose assets never finished. Whatever
      // is missing, the visitor is about to see a hole where a work should be.
      track('gallery_loading_timeout', {
        surface,
        gallery_id: galleryId,
        loaded: assetsLoadedRef.current,
        total: assetsTotalRef.current,
      })
    }, 12_000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Time from mount to the doors opening — the visitor's real wait.
  useEffect(() => {
    if (!loadingDone) return
    sessionFlags.roomOpened = true
    track('gallery_loading_done', {
      surface,
      gallery_id: galleryId,
      ms: Date.now() - mountedAt.current,
      assets: assetsTotalRef.current,
      timed_out: waitedOut,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingDone])

  // Open the doors once the room is really there. The 400ms is a debounce as much
  // as a beat: assets register in waves (GLBs, then artwork textures), and if a
  // new wave starts this effect re-runs and clears the timer.
  useEffect(() => {
    if (preOpen || !hydrated) return
    if (!assetsIdle && !waitedOut) return
    // **シェーダを作り終えるまで開けない**（`Warmup`）。ここで待たないと、扉が開いた
    // あとに歩くたびコンパイルの停止が起きる ── 待つと分かっている場所へ costs を移す。
    // WebGL が無い環境（`FlatGallery`）に Canvas は無く `warm` が永久に false なので、
    // その経路では待たない。12秒の保険（`waitedOut`）も効く。
    if (webgl && !warm && !waitedOut) return
    const t = setTimeout(() => setPreOpen(true), 400)
    return () => clearTimeout(t)
  }, [preOpen, hydrated, assetsIdle, waitedOut, webgl, warm])

  // **扉そのものは、実際のパイプラインで滑らかに描けてから開ける**（`SettleGate`）。
  // `preOpen` で起こした設定の書き換え（/demo のテーマと見本）が影の焼き直しを呼ぶので、
  // それが終わるまで待つ。同じ番で、ポスト処理や反射床の初回コストも一緒に消化される。
  // WebGL が無い経路では `settled` が永久に false なので待たない。
  useEffect(() => {
    if (loadingDone || !preOpen) return
    if (webgl && !settled && !waitedOut) return
    setLoadingDone(true)
  }, [loadingDone, preOpen, webgl, settled, waitedOut])

  // Recover from the browser taking the GPU away — iOS Safari does this on app
  // switch or memory pressure, and there was no handler at all, so the room just
  // stayed black (the startup WebGL probe had already passed, so it never fell
  // back to the 2D list either).
  //
  // preventDefault() is the part that buys the recovery: the default action for
  // `webglcontextlost` is to never restore the context.
  //
  // The element is found by querying the DOM rather than through R3F. Three
  // tidier routes were tried first and all failed on a real production build:
  // `canvasRef` is still null when a parent effect runs, `onCreated` never fired
  // here at all (the touchAction it sets was unset on the live canvas), and a
  // `useThree` component inside the Canvas never received the event either. A
  // listener added straight to `document.querySelector('canvas')` demonstrably
  // does fire, so that is what we use — polling briefly because the canvas
  // appears a tick or two after this effect first runs.
  useEffect(() => {
    if (!ready || !webgl) return
    let el: HTMLCanvasElement | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let lostAt = 0
    const onLost = (e: Event) => {
      e.preventDefault()
      setContextLost(true)
      lostAt = Date.now()
      // The browser took the GPU away and the room went black. Silent until now,
      // and indistinguishable from "the visitor lost interest".
      track('gallery_context_lost', { surface, gallery_id: galleryId })
    }
    const onRestored = () => {
      setContextLost(false)
      setCanvasKey((k) => k + 1) // rebuild the scene against the new context
      track('gallery_context_restored', {
        surface,
        gallery_id: galleryId,
        ms: lostAt ? Date.now() - lostAt : undefined,
      })
    }
    const attach = (tries = 0) => {
      el = document.querySelector<HTMLCanvasElement>('canvas')
      if (!el) {
        if (tries < 40) retry = setTimeout(() => attach(tries + 1), 200)
        return
      }
      el.addEventListener('webglcontextlost', onLost)
      el.addEventListener('webglcontextrestored', onRestored)
    }
    attach()
    return () => {
      if (retry) clearTimeout(retry)
      el?.removeEventListener('webglcontextlost', onLost)
      el?.removeEventListener('webglcontextrestored', onRestored)
    }
  }, [ready, webgl, canvasKey])

  // Admin-set demo theme (/admin → Demo look): apply AFTER hydration settles
  // (`preOpen` is set past both hydrate passes) so loadSettings can't clobber it.
  // Guest showcase only — never a signed-in owner's room or a real visitor page.
  // **`loadingDone` ではなく `preOpen` で起こす。** テーマを変えると `bakeKey` が変わって
  // 壁の影が全部焼き直されるので、扉が開いてからやると来場者の目の前で止まる（実測250ms）。
  useEffect(() => {
    if (preOpen && demoTheme && !user && !visitor && THEMES[demoTheme]) {
      useGallery.getState().updateSettings({ theme: demoTheme })
    }
  }, [preOpen, demoTheme, user, visitor])

  // /demo "sampler": seed a curated per-work look (varied frames/mats/hangings/
  // captions) so walking the showcase shows the range. In-memory only (setState, not
  // updateSettings) so it never persists into a guest's own localStorage settings.
  // **こちらも `preOpen`。** 額・マット・掛け方・銘板を差し替えるので `bakeKey` が変わる
  // ＝2度目の焼き直しになる。上のテーマと合わせて、扉の手前で済ませる。
  useEffect(() => {
    if (demo && preOpen && !user && !visitor) {
      useGallery.setState(demoDesignOverrides())
    }
  }, [demo, preOpen, user, visitor])

  return (
    <>
      {/* スキップリンク（U3）。視覚的には隠れていて、ページ内で最初にTabすると現れる。
          押すと3Dを畳んで FlatGallery（等価な代替）へ切り替える。forceFlat 中は
          既にリスト側にいるので出さない（戻る導線は FlatGallery 側にある）。 */}
      {ready && webgl && !forceFlat && (
        <button
          type="button"
          className="gallery-a11y-toggle"
          onClick={() => setForceFlat(true)}
        >
          {t('hud.skipToList')}
        </button>
      )}
      {ready && webgl && !forceFlat && (
        <Canvas
          key={canvasKey}
          className="stage-root"
          gl={{ antialias: true }}
          // Shadows MUST be declared here, not set manually in onCreated: R3F
          // re-applies this prop on every canvas reconfigure (e.g. the dpr
          // downgrade below), and an unset prop resets shadowMap.enabled=false —
          // which was silently killing every real shadow a few seconds after load.
          // 'percentage' = PCFShadowMap: three r185 removed PCFSoftShadowMap (it
          // force-downgrades to PCF with a warning); the soft penumbra comes from
          // each light's shadow-radius instead.
          shadows={QUALITY !== 'low' ? 'percentage' : false}
          dpr={dpr}
          camera={{ fov: 60, near: 0.1, far: 100, position: [entryRef.current.x, 1.6, entryRef.current.z] }}
          onCreated={({ gl, camera }) => {
            camera.rotation.order = 'YXZ'
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = 1.1
            // The scene is static, so shadows are baked (GalleryScene sets
            // needsUpdate; enabled/type come from the `shadows` prop above).
            // autoUpdate isn't managed by R3F, so setting it once here is safe.
            gl.shadowMap.autoUpdate = false
            gl.domElement.style.touchAction = 'none'
            // ラベルの無い canvas は空要素としてアクセシビリティツリーに残るだけで
            // 実害は軽いが、正式には隠す。操作と情報はHUD側のDOM（ボタン・パネル）が
            // 持っている（U3・2026-08-16）。
            gl.domElement.setAttribute('aria-hidden', 'true')
            canvasRef.current = gl.domElement // for the walkthrough recorder
          }}
        >
          {/* Weak-GPU desktops: after sustained low FPS, drop render resolution once
              (no onIncline restore — flipping back and forth is more jarring).
              Armed only after the loading screen so the shadow-bake/texture-load dip
              can't trigger it, and ignored while the tab is hidden (rAF throttling
              reads as low FPS there).
              **診断モード（`?perf=...`）では止める** ── 測っている最中に解像度が
              変わると、切った/切らないの数字が比べられなくなる。 */}
          {QUALITY === 'high' && loadingDone && !PERF.on && (
            <PerformanceMonitor
              flipflops={2}
              onDecline={() => {
                if (document.visibilityState !== 'visible') return
                // Read through a ref and track outside the updater: a state
                // updater must stay pure (StrictMode invokes it twice in dev,
                // which would double-count the event).
                const from = dprRef.current[1]
                const next: [number, number] = from > 1.5 ? [1, 1.5] : [1, 1.25] // 2 → 1.5 → 1.25
                dprRef.current = next
                setDpr(next)
                track('gallery_perf_downgrade', {
                  surface,
                  gallery_id: galleryId,
                  from_dpr: from,
                  to_dpr: next[1],
                })
              }}
            />
          )}
          <AdaptiveFov />
          {/* アセットが揃ったら、扉を開ける前にシェーダを全部作る（下の `Warmup`） */}
          <Warmup armed={hydrated && (assetsIdle || waitedOut)} onDone={onWarm} />
          {/* 扉を開ける前に、実際のパイプラインが落ち着くのを待つ（上の `SettleGate`） */}
          <SettleGate armed={preOpen && !loadingDone} onSettled={onSettled} />
          {/* 歩行中だけ解像度を落とす試験（既定は無効。上の `AdaptiveDpr` を参照） */}
          {PERF.adaptive && loadingDone && <AdaptiveDpr onMoving={onMoving} />}
          <GalleryScene />
        </Canvas>
      )}
      {ready && flatMode && (
        <FlatGallery onBackTo3d={webgl && forceFlat ? () => setForceFlat(false) : undefined} />
      )}

      <HudTop />
      {webgl !== false && !forceFlat ? (
        <>
          <Hint />
          <HudStepper />
          <MiniMap />
          <RoomSwitch />
          <ArtworkPanel />
        </>
      ) : null}
      <HudActions />
      <InfoPanel />
      <SettingsPanel />
      <GuestbookPanel />
      <Toast />
      {/* The browser took the GPU away. Some devices hand it straight back (we
          rebuild automatically); iOS often waits until the page is interacted
          with, so give the visitor a way to ask. */}
      {contextLost && (
        <div className="ctx-lost" role="alert">
          <div className="ctx-lost-inner">
            <p className="ctx-lost-title">{t('contextLost.title')}</p>
            <p className="ctx-lost-sub">{t('contextLost.body')}</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setContextLost(false)
                setCanvasKey((k) => k + 1)
              }}
            >
              {t('contextLost.rebuild')}
            </button>
          </div>
        </div>
      )}

      {/* Personalised for a public gallery (visitor mode), house-branded on /demo.
          `roomTransition` forces it back open the instant a doorway is used, even
          though this page's own loading already finished. */}
      <LoadingScreen
        exhibition={visitor}
        done={loadingDone && !roomTransition}
        progress={assetsTotal > 0 ? loadPct : undefined}
      />
    </>
  )
}
