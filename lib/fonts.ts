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

/** 例: serifFont(44) → `400 44px 'Bodoni Moda', Georgia, serif` */
export function serifFont(px: number, { italic = false, weight = 400 }: FontOpts = {}): string {
  return `${italic ? 'italic ' : ''}${weight} ${px}px ${cssFamily('--serif', FALLBACK_SERIF)}`
}

/** 例: sansFont(26, { weight: 500 }) → `500 26px 'Geist', sans-serif` */
export function sansFont(px: number, { italic = false, weight = 400 }: FontOpts = {}): string {
  return `${italic ? 'italic ' : ''}${weight} ${px}px ${cssFamily('--sans', FALLBACK_SANS)}`
}
