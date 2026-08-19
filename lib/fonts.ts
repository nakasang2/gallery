import { useEffect, useState } from 'react'

/**
 * canvas に文字を焼くときの書体指定。
 *
 * **書体名の唯一の定義は `app/landing.css` の `--serif` / `--sans`**（DECISIONS 2026-08-12・D-1）。
 * ところが canvas は `ctx.font` に**書体名を文字列で**渡す必要があり `var()` を解決できないので、
 * これまで `"Instrument Serif"` が textures.ts に3か所・HeroScene.tsx に1か所**写されていた**。
 * 写しは【絶対ルール】2026-08-12（同じ意味の値を2か所で持たない）に反するうえ、実害の前例がある
 * ── 2026-08-12 に CSS 側だけが読み込まれていない書体を指していて、**HUD が自分の壁の文字と
 * 違う書体で描かれていた**。定数を書き写す代わりに、**実際に効いている CSS の値を読み出す**。
 */

const FALLBACK_SERIF = 'Georgia, serif'
const FALLBACK_SANS = 'system-ui, sans-serif'

/** 解決済みの値。書体はページの寿命の中で変わらないので一度引ければ使い回す。
 *  空文字（＝まだスタイルが当たっていない）は覚えない — 覚えるとフォールバックで固定されてしまう。 */
const resolved = new Map<string, string>()

function cssFamily(token: '--serif' | '--sans', fallback: string): string {
  const hit = resolved.get(token)
  if (hit) return hit
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (!value) return fallback
  resolved.set(token, value)
  return value
}

type FontOpts = { italic?: boolean; weight?: number }

/** 例: serifFont(44) → `400 44px 'Vollkorn', Georgia, serif` */
export function serifFont(px: number, { italic = false, weight = 400 }: FontOpts = {}): string {
  return `${italic ? 'italic ' : ''}${weight} ${px}px ${cssFamily('--serif', FALLBACK_SERIF)}`
}

/** 例: sansFont(26, { weight: 500 }) → `500 26px 'Geist', sans-serif` */
export function sansFont(px: number, { italic = false, weight = 400 }: FontOpts = {}): string {
  return `${italic ? 'italic ' : ''}${weight} ${px}px ${cssFamily('--sans', FALLBACK_SANS)}`
}

/* ---- canvas に焼く前に、その文字列に必要な書体を取り寄せる ---- */

/** その焼き手が実際に使う書体指定（`px` は face の選択に影響しないので代表値でよい）。
 *
 *  **ウェイトは 400 と 700 の2本しか引かない** ── 実測（2026-08-19）で、300/500 の指定も
 *  400 を読み込めば `check` が true になることを確認した（CSSの照合が近い方へ落ちる）。
 *
 *  **使わない指定を混ぜてはいけない。** 混ぜると `check` が永久に false のままになり
 *  （斜体のCJKフェイスは存在しない・斜体はDOMのどこからも要求されない）、**毎回「足りない」
 *  判定になって焼き直しが必ず1回走る**。題箋(512×300)×作品数 ＋ 壁(2048×1024) が丸ごと
 *  無駄になるうえ、要らないスライスまで落とす。既定は「立体の明朝＋ゴシック」だけ。 */
type CanvasFontNeed = {
  /** 斜体の明朝を焼くか（LP廊下パネルの大きな番号だけ） */
  italic?: boolean
  /** 太字のゴシックを焼くか（600以上の指定。LP廊下パネルの見出しだけ） */
  bold?: boolean
}

function canvasFontSpecs({ italic = false, bold = false }: CanvasFontNeed): string[] {
  const specs = [serifFont(44), sansFont(44)]
  if (italic) specs.push(serifFont(44, { italic: true }))
  if (bold) specs.push(sansFont(44, { weight: 700 }))
  return specs
}

function canLoad(spec: string, text: string): boolean {
  try {
    return !document.fonts.check(spec, text)
  } catch {
    return false // 判定できないなら焼き直しを起こさない（現状のまま描く）
  }
}

/**
 * **canvas は書体を自分で取ってこない。** DOM に一度も出ていない字は、`document.fonts.status`
 * が `'loaded'` でも落ちてきていない ── 実測 2026-08-19: 宣言済みの日本語書体でも
 * `document.fonts.check("400 44px '…'", '黌')` が **false** だった。日本語は unicode-range で
 * 約120枚に分けて配信されるので、**作品タイトルの字を含む1枚が来ている保証がない**。
 * そのまま焼くと、題箋や壁の文字だけが黙ってOS標準の書体になる。
 *
 * 連鎖（`'Vollkorn', 'Zen Old Mincho', Georgia, serif`）ごと渡してよい ── 実測で、
 * 日本語8字に対し必要な5枚だけが落ち、欧文しか持たない書体は読み込まれなかった。
 *
 * 何も足りていなければ `null` を返す（＝呼び手は焼き直さない）。
 */
export function ensureCanvasFonts(text: string, need: CanvasFontNeed = {}): Promise<unknown> | null {
  if (typeof document === 'undefined' || !text.trim()) return null
  const specs = canvasFontSpecs(need).filter((spec) => canLoad(spec, text))
  if (specs.length === 0) return null
  return Promise.all(specs.map((spec) => document.fonts.load(spec, text).catch(() => undefined)))
}

/**
 * `text` を焼くのに必要な書体が届いたら 1 つ増える値。**`useMemo` の依存に混ぜて使う**
 * ことで、届いた時点で1度だけ焼き直させる（`0` のままなら焼き直しは起きない）。
 *
 * 焼く場所は3つ（題箋・壁の展示タイトル・LP廊下のパネル）あり、同じ手当てを写して
 * 書かないためにここに置いている（【絶対ルール】2026-08-12）。
 */
export function useCanvasFontsReady(text: string, need: CanvasFontNeed = {}): number {
  const [tick, setTick] = useState(0)
  const italic = need.italic ?? false
  const bold = need.bold ?? false
  useEffect(() => {
    const pending = ensureCanvasFonts(text, { italic, bold })
    if (!pending) return
    let alive = true
    pending.then(() => {
      if (alive) setTick((n) => n + 1)
    })
    return () => {
      alive = false
    }
    // `need` はオブジェクトなので毎レンダー新しくなる。**中身を展開して依存にする**
    // （オブジェクトをそのまま入れると毎レンダー再実行になる）。
  }, [text, italic, bold])
  return tick
}
