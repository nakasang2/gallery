'use client'
// 来場者が選ぶ描画の好み。いまは「なめらかさ優先」の入/切だけ（DECISIONS 2026-08-19）。
//
// **既定は「切」＝今までどおり。** 遅い機械は `PerformanceMonitor` が低FPSを検出して
// 自動で歩行中の解像度を下げるので、すでに助かっている。ここが要るのは
// **「自動では発動しないが、なめらかさを取りたい人」**のため。
// 入にすると、歩いている間だけ解像度を等倍まで落とし、止まると最高画質に戻す。
//
// `lib/audio.ts` の BGM と同じ作法 ── 端末に覚えさせる小さな入れ物を1つ置き、
// React からは `useSyncExternalStore` で読む。**部屋の設定（`lib/store.ts`）には混ぜない**:
// あれは作家が決める展示の中身で、こちらは来場者の端末ごとの表示の好み。混ぜると
// 作家の保存データに来場者の設定が紛れ込む。
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'xibit360.smoothMotion'

let smooth = false
let loaded = false
const subscribers = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    smooth = localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // プライベートモード等で localStorage が読めない端末がある。既定のまま進める
    // （覚えられないだけで、その場の切替は効く）。
  }
}

export const renderPref = {
  get smooth() {
    load()
    return smooth
  },
  toggle() {
    load()
    smooth = !smooth
    try {
      localStorage.setItem(STORAGE_KEY, smooth ? '1' : '0')
    } catch {
      // 同上。保存できなくても切替そのものは通す
    }
    subscribers.forEach((f) => f())
    return smooth
  },
  subscribe(f: () => void) {
    subscribers.add(f)
    return () => {
      subscribers.delete(f)
    }
  },
}

/** 「なめらかさ優先」が入っているか。
 *
 *  **サーバー側のスナップショットは常に `false`** ── ここで `localStorage` の値を返すと、
 *  サーバーが描いたHTMLと最初の描画が食い違って hydration が壊れる。React は
 *  hydration の間だけこちらを使い、済んだあとに本当の値へ切り替えてくれる。 */
export function useSmoothMotion(): boolean {
  return useSyncExternalStore(
    renderPref.subscribe,
    () => renderPref.smooth,
    () => false
  )
}
