'use client'
// 作品スポットの共有プール（照明の焼き込み ③・DECISIONS 2026-08-19）。
//
// three.js は前方レンダリングなので、**シーンにある照明を全ピクセルで毎フレーム計算する**。
// 15点の展示なら作品スポット15灯＋ベンチ2灯＝17灯ぶんの計算が画面の全画素に乗る
// （ユーザー実測: 照明を全部外すと 13.8fps → 30以上）。
//
// 明るさの大半（`1 - POOL_MIX`）は `LightmapBaker` が焼いた1枚が運ぶので、ここに残す実照明は
// **「近くの立体に照りと立体感を足す」役だけ**。だから数を絞ってよい。
//
// LP（`components/landing/HeroScene.tsx` の `SpotPool`）と同じ手で、別視点レビュー済みの
// 作法をそのまま持ってきている:
//   - **数は固定する。** 出し入れで照明の数が変わると three.js は全材質のシェーダーを
//     作り直し、歩いている最中に数十msの停止が入る。
//   - **カメラの後ろにあるものは外す。** 後ろの光はいま見えている面を照らせないので、
//     入れると手前の作品が近さで勝ってしまい、正面の作品が選ばれない。
//   - **色は解析済みの `THREE.Color` で持つ。** 毎フレーム文字列から解き直すのは、
//     軽くするための仕組みで払う費用ではない。
import { createContext, Fragment, useContext, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { PERF } from '@/lib/perfFlags'

/** 実照明の数。**作品15点でも15灯は要らない** ── ここが出すのは全体の `POOL_MIX` ぶん
 *  （既定 25%）なので、選ばれなかった作品も焼いたぶんで正しい明るさに見える。選ばれた
 *  作品だけが、そのうえに本物の照りを載せる。増やすと重くなるだけなので、増やす前に
 *  「選ばれない作品が暗く見えるか」を実機で確かめること。 */
export const SPOT_POOL = 6

export interface PooledSpot {
  /** 位置と的は**空の Object3D 2つ**で持つ。親 `group` の変換をそのまま引き継ぐので、
   *  木のどこに置いても「いま照らしている場所」が正しく出る（手で世界座標に直すと、
   *  親が回転している箇所で必ず間違える。LP で実際に踏んだ）。 */
  from: THREE.Object3D
  to: THREE.Object3D
  color: THREE.Color
  intensity: number
  angle: number
  penumbra: number
  decay: number
}

const Registry = createContext<PooledSpot[] | null>(null)

/** プールが上にあるか。**無ければ従来どおり自前の実照明を出す**のが呼び出し側の作法
 *  ── ダッシュボードのテーマプレビュー（`components/Preview3D`）と影の焼き込み
 *  （`ShadowBakeRunner`）は、部屋ぜんぶを持たない小さなシーンなので焼く相手がいない。
 *  ここで false を返さないと、そちらの作品が地明かりだけになって暗くなる。 */
export function useHasSpotPool(): boolean {
  return useContext(Registry) !== null
}

export function SpotPoolProvider({ children }: { children: React.ReactNode }) {
  const items = useMemo<PooledSpot[]>(() => [], [])
  return (
    <Registry.Provider value={items}>
      {children}
      <SpotPool />
    </Registry.Provider>
  )
}

/** 照らす一点の登録。**ここに本物の照明は無い。** */
export function useRegisterSpot(def: Omit<PooledSpot, 'from' | 'to'>, from: THREE.Object3D, to: THREE.Object3D) {
  const items = useContext(Registry)
  const { color, intensity, angle, penumbra, decay } = def
  useEffect(() => {
    if (!items) return
    const entry: PooledSpot = { from, to, color, intensity, angle, penumbra, decay }
    items.push(entry)
    return () => {
      const i = items.indexOf(entry)
      if (i >= 0) items.splice(i, 1)
    }
  }, [items, from, to, color, intensity, angle, penumbra, decay])
}

function SpotPool() {
  const items = useContext(Registry)
  // `?perf=nolights` は「照明を全部外したときの上限」を測るための診断スイッチ
  // （DECISIONS 2026-08-18）。**プールがここを見ていないと、外したはずの作品スポットが
  // `POOL_MIX` の強さで6灯残る** ── その状態で測った数字を上限だと思って `POOL_MIX` を
  // 決めることになる。登録（`useRegisterSpot`）はそのままでよく、実体を出さなければ
  // シーンの照明数はちゃんと0になる。
  const enabled = PERF.lights
  const lights = useRef<(THREE.SpotLight | null)[]>([])
  const targets = useRef<(THREE.Object3D | null)[]>([])
  const fwd = useMemo(() => new THREE.Vector3(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const wp = useMemo(() => new THREE.Vector3(), [])
  // 毎フレームの確保をしないよう、選抜用の枠は使い回す
  const best = useMemo(
    () => Array.from({ length: SPOT_POOL }, () => ({ s: null as PooledSpot | null, d: Infinity })),
    []
  )

  useFrame(({ camera }) => {
    if (!items || !enabled) return
    camera.getWorldDirection(fwd)
    for (let k = 0; k < SPOT_POOL; k++) {
      best[k].s = null
      best[k].d = Infinity
    }
    for (const s of items) {
      s.to.getWorldPosition(v)
      v.sub(camera.position)
      if (v.dot(fwd) <= 0) continue // カメラの後ろ
      const d = v.lengthSq()
      // 近い順に SPOT_POOL 件だけ残す（最大15件なので挿入のほうが並べ替えより速く、確保もしない）
      for (let k = 0; k < SPOT_POOL; k++) {
        if (d < best[k].d) {
          for (let m = SPOT_POOL - 1; m > k; m--) {
            best[m].s = best[m - 1].s
            best[m].d = best[m - 1].d
          }
          best[k].s = s
          best[k].d = d
          break
        }
      }
    }
    for (let k = 0; k < SPOT_POOL; k++) {
      const light = lights.current[k]
      const tgt = targets.current[k]
      if (!light || !tgt) continue
      const s = best[k].s
      if (!s) {
        light.intensity = 0
        continue
      }
      s.from.getWorldPosition(wp)
      light.position.copy(wp)
      s.to.getWorldPosition(wp)
      tgt.position.copy(wp)
      tgt.updateMatrixWorld()
      light.color.copy(s.color)
      light.intensity = s.intensity
      light.angle = s.angle
      light.penumbra = s.penumbra
      light.decay = s.decay
    }
  })

  if (!enabled) return null
  // プールの照明は**シーンの直下に置く**（親の変換が掛かると、上で入れた世界座標がずれる）
  return (
    <>
      {Array.from({ length: SPOT_POOL }, (_, k) => (
        <Fragment key={k}>
          <spotLight
            ref={(el) => {
              lights.current[k] = el
              if (el && targets.current[k]) el.target = targets.current[k]!
            }}
            intensity={0}
            decay={2}
          />
          <object3D
            ref={(el) => {
              targets.current[k] = el
              if (el && lights.current[k]) lights.current[k]!.target = el
            }}
          />
        </Fragment>
      ))}
    </>
  )
}
