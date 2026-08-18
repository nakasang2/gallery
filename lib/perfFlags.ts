/**
 * 重さの原因を**推測で削らずに測る**ための診断スイッチ（2026-08-18）。
 *
 * **既定では何も変わらない。** URLに `?perf=...` を付けたときだけ効く。
 * ユーザーは DevTools の Frame Rendering Stats（FPSメーター）を出したまま、
 * 下の値を1つずつ試して数字を報告できる ── どれをいくら削るといくら戻るかが確定してから、
 * 見た目を犠牲にする価値があるものだけを恒久的に変えるための土台。
 *
 * なぜ要るか: **Chrome の Performance の Summary では WebGL の重さが分からない。**
 * `Rendering` / `Painting` は DOM と CSS の数字で、WebGLのGPU処理はそこに現れない。
 * それを「出ていない＝無罪」と読んで、いちばん疑うべき演出を長く無罪にしていた
 * （LESSONS 2026-08-18）。**画素数に比例するかどうかは、切って測るのが唯一確実。**
 *
 * 値（カンマ区切りで併用可）:
 *   base   … 何も切らない。**比較の基準**（下の「固定」だけ効く）
 *   dpr1   … 描画解像度を等倍に（画素数がいちばん効く）
 *   noao   … N8AO（接触陰影）だけ外す
 *   nofx   … 後処理をまるごと外す（AO・Bloom・SMAA・4xマルチサンプル・霧）
 *   norefl … 床の平面反射を外す（ふつうの光沢床にする）
 *   off    … 上の全部
 *   adaptive … **歩いている間だけ解像度を落とし、立ち止まったら最高画質に戻す**
 *              （切る話ではなく別方式の試験。下の `adaptive` を参照）
 *
 * **どれかが指定されたら、解像度の自動引き下げも止める。** 測っている最中に
 * `PerformanceMonitor` が dpr を下げると、前後の数字が比べられなくなるため。
 */

export type PerfFlags = {
  /** 何かしら指定されている（＝診断モード。自動引き下げを止める） */
  readonly on: boolean
  /** 後処理を出すか */
  readonly fx: boolean
  /** N8AO（接触陰影）を出すか */
  readonly ao: boolean
  /** 床の平面反射を出すか */
  readonly reflector: boolean
  /** 描画解像度を通常どおりにするか（false なら等倍） */
  readonly fullDpr: boolean
  /** 歩行中だけ解像度を落とし、静止したら戻すか（`?perf=adaptive`）
   *
   *  ギャラリーは**歩いて近づき、立ち止まって観る**もの。観ている瞬間の解像度は
   *  落とせない一方、**動いている間のぼやけは動いていること自体に紛れる**。
   *  実測（ユーザーのPC・2026-08-18）: 等倍 33.6fps / 通常 13.8fps ── 演出を全部
   *  切っても 36.0fps なので、**効くのは画素数だけ**。ならば「いつ画素を使うか」を
   *  選ぶのが唯一まともな設計になる。
   *
   *  **既定では無効**。解像度の切り替えは描画バッファを作り直すので一瞬の引っかかりが
   *  出うる（このコードには「行ったり来たりは不快だった」という記録がある）。
   *  実機で触って良ければ既定にする、というのがこの旗の目的。 */
  readonly adaptive: boolean
}

function read(): PerfFlags {
  const none: PerfFlags = { on: false, fx: true, ao: true, reflector: true, fullDpr: true, adaptive: false }
  if (typeof window === 'undefined') return none
  let raw: string | null = null
  try {
    raw = new URLSearchParams(window.location.search).get('perf')
  } catch {
    return none
  }
  if (!raw) return none
  const set = new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  if (set.size === 0) return none
  const all = set.has('off')
  const flags: PerfFlags = {
    on: true,
    fx: !(all || set.has('nofx')),
    ao: !(all || set.has('nofx') || set.has('noao')),
    reflector: !(all || set.has('norefl')),
    fullDpr: !(all || set.has('dpr1')),
    adaptive: set.has('adaptive'),
  }
  // 効いていることが分かるように1行だけ出す（診断モードのときだけ）
  // eslint-disable-next-line no-console
  console.info('[perf] 診断モード:', {
    指定: [...set].join(','),
    後処理: flags.fx,
    接触陰影: flags.ao,
    反射床: flags.reflector,
    解像度: flags.adaptive ? '歩行中だけ落とす' : flags.fullDpr ? '通常' : '等倍',
    自動引き下げ: '停止',
  })
  return flags
}

/** ページの寿命のあいだ変わらないので一度だけ読む。 */
export const PERF: PerfFlags = read()
