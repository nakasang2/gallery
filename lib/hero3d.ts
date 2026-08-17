/**
 * LPの3D美術館（`components/landing/HeroScene`）を走らせてよい環境かどうかの判定。
 *
 * **判定をここ1か所に置く理由**: 答えを必要とする側が2つある ── 3Dを描く `HeroCanvas` と、
 * 3Dが出ないときだけCSSの額装壁を焼く `LandingEffects`。片方だけが「3Dが出る」と思っていると、
 * **画面に出ない額装を生成し続ける**（実際にそうなっていた。`.has-hero3d .hero-floats` が
 * `display: none` にする要素のために、毎回 660px の生成アートを canvas に描いていた）。
 *
 * 判定は3つ。**どれも「この環境で走らせてよいか」という能力の話**で、相手が誰か（UA）は見ない。
 *
 * 1. 省モーション（`prefers-reduced-motion`）── 従来どおり。
 * 2. WebGL が使えるか ── 従来どおり。
 * 3. **GPUが無く、CPUで1ピクセルずつ描いている環境か（2026-08-17 追加）**。
 *
 * 3つ目を足したのは、**PageSpeed Insights がLPを測れずエラーで落ちていた**ため
 * （`Protocol error (Runtime.evaluate): Target closed` ＝測定中にタブごと死んだ）。
 * PSI と Googlebot が動くマシンには GPU が無く、WebGL は SwiftShader などの
 * ソフトウェア描画に落ちる。そこへ今のLPは 30個の照明・23枚のテクスチャ（約150MB）・
 * 止まらない描画ループを渡すので、測定用コンテナのCPUとメモリを使い切ってしまう。
 *
 * この環境の実在の利用者（ハードウェア支援を切った人・古いドライバが遮断された人・VM）に
 * とっても、今のLPは数fpsでしか動かない。**3Dを出さないほうが速く、きれいに見える**ので、
 * 測定機のためではなく利用者のための切り分けとして正しい。文言は `.corridor-fallback` に
 * 本物の見出しとして残るので、クローラーからも読み上げからも消えない（むしろ良くなる）。
 */

/** ソフトウェア描画のレンダラー名。ANGLE 経由だと括弧の中に入るので部分一致で見る。
 *  - `SwiftShader` … Chrome（headless・GPU無効時）。PSI と Googlebot はこれ。
 *  - `llvmpipe` / `softpipe` … Mesa のソフトウェアラスタライザ（Linux・コンテナ）
 *  - `Basic Render` … Microsoft Basic Render Driver（WindowsでGPUが使えないとき）
 *  - `Software` … Apple Software Renderer ほか、名前に素直に書いてあるもの */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software/i

type Probe = { webgl: boolean; software: boolean }

let cached: Probe | null = null

/** WebGLの能力を1度だけ調べる。使い捨てのコンテキストは**その場で明示的に手放す**
 *  ── ブラウザの同時コンテキスト数には上限があり、調べるためだけの1枚を抱えたままだと
 *  本番のシーンが作れなくなることがある。 */
function probe(): Probe {
  if (cached) return cached
  let webgl = false
  let software = false
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (gl) {
      webgl = true
      // 名前が masked（Firefox の耐フィンガープリント設定など）で読めないことがある。
      // その場合は **従来どおり3Dを出す** ── 読めないことは「遅い」ことの証拠ではない。
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (ext) {
        const name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
        software = SOFTWARE_RENDERER.test(name)
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    webgl = false
  }
  cached = { webgl, software }
  return cached
}

/** LPの3Dを描いてよい環境か。サーバー側では常に false（3DはSSRしない）。 */
export function canRunHero3d(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  const { webgl, software } = probe()
  return webgl && !software
}
