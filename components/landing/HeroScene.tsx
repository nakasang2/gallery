'use client'
// LP専用の3D美術館。固定背景として全スクロールを通して常駐する、1本のカメラ旅路:
//   1. 入口: 右壁の主役アート(インパクト)
//   2. 反対側へ回り込み、番号パネル 01〜06 を順に見る(廊下)
//   3. そのまま廊下の先の「暗闇」へ前進 — 何もない空間なので背景は黒く沈み、
//      中間セクション(Concept〜Pricing)のテキストが読める
//   4. 終盤(Closing)でフォグの奥から「大部屋のギャラリー」が現れる — 廊下を抜けて広間へ
// カメラ位置に合わせて 2D の見出しをオーバーレイする。
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import { renderArtworkCanvas, ARTWORKS, mulberry32 } from '@/lib/artworks'
import { fetchLpFaces, emptyLpFaces, type LpFaces, type LpHeroSlot } from '@/lib/siteConfig'
import { useT } from '@/components/I18nProvider'
import { serifFont, sansFont, useCanvasFontsReady } from '@/lib/fonts'
import { track } from '@/lib/analytics'

/** LP hook: the admin-configured images for every face of the LP's 3D museum
 *  (null per slot = nothing configured, so that frame keeps its built-in demo art
 *  — except the corridor panels, which then show the text board instead).
 *  Lives here (its only caller) so lib/siteConfig stays hook-free and
 *  server-importable. **One request for all five faces** — see fetchLpFaces. */
function useLpFaces(): LpFaces {

  // Start all-empty (the same shape the fetch resolves to) so the first paint falls
  // back to the demo art rather than briefly indexing undefined.
  const [faces, setFaces] = useState<LpFaces>(emptyLpFaces)
  useEffect(() => {
    let alive = true
    fetchLpFaces()
      .then((f) => alive && setFaces(f))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return faces
}

const WALL_X = 4.7
const ITEM_Y = 1.6
const CORRIDOR_END_Z = -39 // 廊下の壁が終わるz(この先は暗い空間)
const HALL_FAR = -124 // 大部屋の遠壁
const HALL_MOUTH = -88 // 大部屋の入口
const HALL_HALF = 18 // 大部屋の半幅

// 入口・右壁の主役アート [作品index, z]
// z はカメラの止まり位置(anchor)も決める。**間隔は入口ビューに3枚とも入る条件で決まっている**
// ── 詳細は下の HERO_SLOTS のコメント。
const HERO_ART: [number, number][] = [
  [0, 6],
  [5, 2.5],
]

// 入口に見える3点(中央/左/右)。最初のビューで右側が空いて見えるのを埋める“3点目”を
// 含む。管理画面の「① 1st View」で画像を設定するとこの枠が差し替わる(未設定はデモ作品に
// フォールバック)。中央/左は HERO_ART と同じ位置。HERO_ART はカメラの止まり位置(anchor)
// も兼ねるので描画用は別で持つ。
//
// **間隔(z)は「入口ビューにスマホでも3枚とも入る」条件で決めている**（ユーザー要望
// 2026-08-19「スマホでも3枚とも入れたい。両サイドは見切れてもいい」）。実装値から
// カメラ投影を解いて確定させた:
//   - 縦画面の横画角は 33°、横画面は 71° と**2倍以上違う**ので、1つのカメラで両方を
//     埋めることはできない。左1/右9.2 では縦画面で左の1枚が完全に画面外だった。
//   - ユーザー案の「カメラを斜めに振る」は、Rig が縦画面で視線方向に 2.4 引くため
//     **カメラが左の壁(x=-4.7)の外へ出てしまう**ので採らなかった。間隔を詰めれば
//     カメラを動かさずに同じ結果になる。
//   - **間隔は「額の外形」で数える。** `Framed` の外箱は **1.18w + 0.12** で、絵より24%大きい
//     （中央は絵2.03m に対し額2.51m）。**絵の幅で数えると間隔を倍に見誤る** ── 実際にやって
//     「すき間1.0m」と書いた値が本当は0.49mで、ユーザーに「寄せすぎじゃない？」と指摘された。
//   - **スマホで3枚とも残る窓は狭い**（左は z<2 で完全に画面外、右は z>9.5 で消える）。
//     その中で**額のすき間が左右そろう**値を採った ── 左0.99m / 右1.03m。
//   - この値での実測（額の外形・ペインの実描画と一致）: PC1280 で 81〜354 / 474〜815 /
//     973〜1393、**すき間 120px / 158px**（額幅の35% / 46%）。右端は画面外へ見切れる。
//     スマホ375 では 左27%・中100%・右11% が見えている＝3枚ともフレーム内（両サイドは見切れ）。
//
// **比率は3枚そろえる**（ユーザー指摘 2026-08-19「右端のだけ縦長でアンバランス」）。
// 元は右が idx 6 "Quiet Heat" = 3:4 の**縦長**で、中央4:3・左3:2 の横長に対して
// 背が高く「サイズが大きい」ように見えていた（幅ではなく高さの話。`Framed` は幅を
// `1.5 × scale` に固定し、高さを作品の比率から出す）。横長の idx 4 に差し替えた。
// ※管理画面から縦長の画像を入れると同じ崩れが戻る ── 差し替えるなら横長を選ぶ。
const HERO_SLOTS: { idx: number; z: number; scale: number }[] = [
  { idx: 0, z: 6, scale: 1.35 }, // center — 4:3
  { idx: 5, z: 2.5, scale: 1.35 }, // left — 3:2
  { idx: 4, z: 9.5, scale: 1.3 }, // right — 4:3（縦長だった idx 6 から差し替え）
]

// 左壁の機能パネル 01〜06。ここに持つのは番号と位置だけで、文言は辞書から引く
// （`lp.f1Title` … `lp.f6Body`）。壁のパネルと Features セクションは同じ6項目なので、
// キーを共有して「壁と一覧で言っていることが違う」状態を作らない。
const PANEL_SPOTS: { n: string; z: number; k: string }[] = [
  { n: '01', z: -6, k: 'f1' },
  { n: '02', z: -11, k: 'f2' },
  { n: '03', z: -16, k: 'f3' },
  { n: '04', z: -21, k: 'f4' },
  { n: '05', z: -26, k: 'f5' },
  { n: '06', z: -31, k: 'f6' },
]

/** 板の代わりに置く写真を収める箱。板（1.7 × 2.23）より一回り大きい ── 板が消えて
 *  1枚だけになるので、同じ寸法だと空いた壁に負けて小さく見える。
 *  上限の根拠: 廊下の床は y=0・天井は y=4.35、写真の中心は `ITEM_Y`=1.6 なので、
 *  高さ2.6なら足元に0.3の余白が残る（2.7を超えると床を突き抜ける）。幅はパネルの
 *  間隔が5あるので2.8でも隣と重ならない。 */
const PANEL_IMG_W = 2.8
const PANEL_IMG_H = 2.6

/** 壁に焼く1枚ぶんの文言（辞書解決済み）＋その位置 */
type PanelText = { n: string; h: string; b: string; z: number }

// 大部屋の作品配置。**並びは管理画面の枠と1対1**（lib/siteConfig の
// `LP_HALL_FRONT_SLOT_LABEL_KEYS` / `LP_HALL_SIDE_SLOT_LABEL_KEYS`）── 順番を入れ替えたら
// ラベルも直す。`idx` は枠が空のときに出る内蔵のデモ作品。
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

type Hud = { eyebrow: string; title: string; body?: string }

/** カメラの止まり位置ごとの見出し（入口の2つ ＋ パネル6枚）。
 *  Body copy rides along in the DOM HUD — the wall textures alone are unreadable
 *  on portrait phones and invisible to screen readers. */
function buildHud(t: (key: string, params?: Record<string, string | number>) => string, panels: PanelText[]): Hud[] {
  return [
    { eyebrow: t('lp.hudRoom'), title: t('lp.hudRoomWork') },
    { eyebrow: t('lp.hudRoom'), title: t('lp.hudRoomWalk') },
    ...panels.map((p) => ({ eyebrow: t('lp.hudFeatures', { n: p.n }), title: p.h, body: p.b })),
  ]
}

// ---- canvas の折り返し ----
// 折り返せる場所は文字体系ごとに違う。ラテン文字とハングルは語間に空白があるので
// 空白で切れるが、日本語・中国語には空白が無く、語で切ると「1行＝全文」になって
// 壁の外まで伸びる（10言語を入れた時点でLPの3D壁がこれで溢れた）。
// 切れる単位だけを文字体系で分け、あとは共通の貪欲詰めで処理する。
//
// 記号/句読点・かな・カタカナ・漢字（拡張A含む）・互換漢字・互換形・全角形。
// ハングル（AC00-D7AF）は語間に空白があるので入れない = ラテンと同じ扱いでよい。
const CJK_BREAKABLE =
  /[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿︰-﹏＀-｠￠-￦]/
// 行頭禁則（終わり括弧・句読点・小書き仮名・長音）。日本語で行頭に「、」が来ると
// 一目で素人組みに見えるので、直前の1トークンを一緒に次の行へ送る。
const NO_LINE_START = /^[、。，．・：；？！゛゜ヽヾゝゞ々ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ」』）］｝〕〉》〟’”,.:;?!)\]}%]/

/** 折り返しの最小単位。`sep` はこのトークンの直前にあった区切り（空白か無し）。 */
type Token = { s: string; sep: string }

function tokenize(text: string): Token[] {
  const out: Token[] = []
  let sep = ''
  let buf = ''
  const flush = () => {
    if (!buf) return
    out.push({ s: buf, sep })
    buf = ''
    sep = ''
  }
  for (const ch of text.replace(/\s+/g, ' ').trim()) {
    if (ch === ' ') {
      flush()
      sep = ' '
    } else if (CJK_BREAKABLE.test(ch)) {
      flush()
      out.push({ s: ch, sep })
      sep = ''
    } else buf += ch
  }
  flush()
  return out
}

const renderLine = (toks: Token[]) => toks.map((tk, i) => (i ? tk.sep + tk.s : tk.s)).join('')

function layoutLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  // 1トークンが幅を超えるとき（長いURLやドイツ語の複合語）だけ、最後の手段として
  // 文字で割る。返すのは割り切れなかった末尾。
  const hardSplit = (s: string): string => {
    let cur = ''
    for (const ch of s) {
      if (cur && ctx.measureText(cur + ch).width > maxW) {
        lines.push(cur)
        cur = ch
      } else cur += ch
    }
    return cur
  }
  // 改行しているのは体裁ではなく番人のため: `=>` と `<=` を同じ行に置くと、
  // check:i18n がその間を「タグに挟まれたJSXテキスト」と読んで誤検知する。
  // i18n-ok で黙らせるとこの行が恒久的に検査対象外になるので、行を分ける方を採る。
  const fits = (toks: Token[]) =>
    ctx.measureText(renderLine(toks)).width <= maxW
  // 新しい行の先頭に置く。**行頭に置くときが唯一「1トークン単体が幅を超える」かを
  // 見られる場所**なので、行の途中で溢れて折り返すときも必ずここを通す。
  const openLine = (tk: Token): Token[] => (fits([tk]) ? [tk] : [{ s: hardSplit(tk.s), sep: '' }])

  let cur: Token[] = []
  for (const tk of tokenize(text)) {
    if (!cur.length) {
      cur = openLine(tk)
      continue
    }
    if (fits([...cur, tk])) {
      cur.push(tk)
      continue
    }
    // 行を確定する。禁則: 行頭に来られない字なら直前の1トークンを一緒に次の行へ送る。
    // 送った2つで幅を超えるなら送らない（禁則より溢れない方を優先する）。
    // 直前が行の唯一のトークンのときも送らない — 空の行ができてしまう。
    const pair: Token[] = [cur[cur.length - 1], tk]
    if (!tk.sep && cur.length > 1 && NO_LINE_START.test(tk.s) && fits(pair)) {
      lines.push(renderLine(cur.slice(0, -1)))
      cur = pair
    } else {
      lines.push(renderLine(cur))
      cur = openLine(tk)
    }
  }
  if (cur.length) lines.push(renderLine(cur))
  return lines
}

/** 折り返して描き、最後の行のベースラインyを返す（次のブロックの起点になる）。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const lines = layoutLines(ctx, text, maxW)
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lh))
  return y + Math.max(0, lines.length - 1) * lh
}

// パネルの文字が入る範囲（左70 / 右70 / 最後の行のベースラインはここまで）
const PANEL_TEXT_W = 770
const PANEL_TEXT_BOTTOM = 1110

function makePanelTexture(p: { n: string; h: string; b: string }): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 900
  c.height = 1180
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#efeade'
  ctx.fillRect(0, 0, 900, 1180)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#cfc9b6'
  ctx.font = serifFont(320, { italic: true })
  ctx.fillText(p.n, 70, 372)
  ctx.fillStyle = '#191917'
  ctx.font = sansFont(62, { weight: 600 })
  const hy = wrapText(ctx, p.h, 70, 580, PANEL_TEXT_W, 76)
  ctx.fillStyle = '#5a584f'
  // 本文の長さは言語で倍近く変わる（CJKは1字が全角、独語は語が長い）。行数が増えて
  // 板の下に落ちるときは、文字サイズを1段ずつ落として収める — textures.ts の名板が
  // CJKのタイトルに対してやっているのと同じ手当て。
  const bodyTop = hy + 96
  const sizes = [38, 34, 30, 26]
  for (const px of sizes) {
    ctx.font = sansFont(px)
    const lh = Math.round(px * 1.47)
    const lines = layoutLines(ctx, p.b, PANEL_TEXT_W)
    const last = bodyTop + (lines.length - 1) * lh
    if (last <= PANEL_TEXT_BOTTOM || px === sizes[sizes.length - 1]) {
      lines.forEach((line, i) => ctx.fillText(line, 70, bodyTop + i * lh))
      break
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

// ---- スポットライトの共有プール ----
//
// **three.js は前方レンダリングなので、シーンに置いた照明はすべて、画面の全ピクセルの
// シェーダーの中で毎フレーム計算される** ── 霧の向こうにあって1ミリも寄与しないものも
// 含めて。このLPは照らす場所が17か所あり、画面いっぱいに広がる廊下の壁に対して17個ぶんの
// ループが回っていた。GPUのある機械では見えないが、これがページで最も重い処理だった。
//
// 代わりに**本物の照明は12個だけ**置き、毎フレーム「いまカメラの前にあって近い8か所」へ
// 割り当て直す。**照明の数が変わらないのが要点** ── `visible` を切り替えたり出し入れして
// 数を変えると、three.js はその都度すべての材質のシェーダーを作り直すので、スクロールの
// 途中で数十msの停止が入る（数を固定すれば一度も起きない）。
//
// **数の根拠は目分量ではなく実測**。カメラ経路（`buildAnchors` と同じ補間）を2000点に
// 刻み、各点で「カメラの前にあって霧（`fogFar`）の内側にある」照明を数えたところ、
// **最大10個**（カメラが板05のあたりに来て、廊下の板と奥の通路の作品が同時に霧の中に
// 入る瞬間）。**足りないと、見えているはずの光だまりが1つ消える**ので、2個の余裕を足す。
// ※作品や板を足したら、この最大値は変わる。**増やしたら数え直すこと。**
const SPOT_POOL = 12

/** プールへの登録1件。**位置は数値ではなく空の Object3D 2つで持つ。**
 *  親の `group` の変換をそのまま受けるので、木のどこに置いても「いま照らしている場所」を
 *  そのまま引き継げる（座標を手で世界座標に書き直すと、親が回転している箇所で必ず間違える）。 */
type SpotDef = {
  from: THREE.Object3D
  to: THREE.Object3D
  /** **解析済みの色を持つ。** 毎フレーム `light.color.set('#ffeed6')` と文字列で渡すと、
   *  three.js は正規表現で読み直す ── 8個 × 60fps ＝ 毎秒480回。軽くするための仕組みで
   *  払う費用ではない（別視点レビュー 2026-08-18）。登録後に色は変わらないので1度だけ解く。 */
  color: THREE.Color
  intensity: number
  angle: number
  distance: number
}

const SpotRegistry = createContext<SpotDef[] | null>(null)

/** 照らす一点。**ここに本物の照明は無い** — 実体は `SpotPool` が持つ8個で、
 *  この部品は「どこから・どこへ・どんな強さで」を登録するだけ。 */
function Spot({ pos, target, color = '#ffeed6', intensity = 120, angle = 0.55, distance = 13 }: { pos: [number, number, number]; target: [number, number, number]; color?: string; intensity?: number; angle?: number; distance?: number }) {
  const items = useContext(SpotRegistry)
  const from = useRef<THREE.Object3D>(null!)
  const to = useRef<THREE.Object3D>(null!)
  useEffect(() => {
    if (!items || !from.current || !to.current) return
    const def: SpotDef = { from: from.current, to: to.current, color: new THREE.Color(color), intensity, angle, distance }
    items.push(def)
    return () => {
      const i = items.indexOf(def)
      if (i >= 0) items.splice(i, 1)
    }
  }, [items, color, intensity, angle, distance])
  return (
    <>
      <object3D ref={from} position={pos} />
      <object3D ref={to} position={target} />
    </>
  )
}

/** SPOT_POOL 個の実照明。毎フレーム、登録の中から「カメラの前にあって近い順」に選び直す。
 *  **カメラの後ろにあるものは外す** ── 後ろの光は、いま見えている面を照らせない。
 *  これが無いと、大部屋に入った瞬間に手前の通路の照明が近さで勝ってしまい、
 *  遠壁の作品（到着地点＝いちばん見せたいもの）が暗いままになる。 */
function SpotPool() {
  const items = useContext(SpotRegistry)
  const lights = useRef<(THREE.SpotLight | null)[]>([])
  const targets = useRef<(THREE.Object3D | null)[]>([])
  const fwd = useMemo(() => new THREE.Vector3(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const wp = useMemo(() => new THREE.Vector3(), [])
  // 毎フレームの確保をしないよう、選抜用の枠は使い回す
  const best = useMemo(
    () => Array.from({ length: SPOT_POOL }, () => ({ s: null as SpotDef | null, d: Infinity })),
    [],
  )

  useFrame(({ camera }) => {
    if (!items) return
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
      // 近い順に SPOT_POOL 件だけ残す（17件なので挿入のほうが並べ替えより速く、確保もしない）
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
      light.distance = s.distance
    }
  })

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
            penumbra={0.7}
            decay={1.0}
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

function Panel({ p }: { p: PanelText }) {
  // 題箋と同じ理由で、書体が届いたら焼き直す（lib/fonts.ts の説明）。ここは板の番号を
  // 320px の斜体で焼くので、フォールバックに落ちると一番目立つ。
  // 斜体（320pxの番号）と太字（62px/600の見出し）を焼くのはここだけ ── 使う指定だけを頼む
  const panelFonts = useCanvasFontsReady(`${p.n}${p.h}${p.b}`, { italic: true, bold: true })
  const tex = useMemo(() => makePanelTexture(p), [p, panelFonts])
  useEffect(() => () => tex.dispose(), [tex])
  const w = 1.7
  const h = w * (1180 / 900)
  return (
    <>
    <group position={[-WALL_X + 0.08, ITEM_Y, p.z]} rotation-y={Math.PI / 2}>
      <mesh position={[0, 0, -0.04]}>
        <boxGeometry args={[w + 0.18, h + 0.18, 0.07]} />
        <meshStandardMaterial color="#141416" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} roughness={0.6} />
      </mesh>
    </group>
      {/* **スポットは `group` の外に置く。ここが世界座標で、中に入れるとローカル座標になる。**
          2026-08-17 まで、この光源は上の `group`（`rotation-y=π/2`）の**中**にあり、世界座標の
          つもりで書かれた数値が回転を受けて `(p.z - 4.62, 5.8, p.z + 2.1)` へ飛んでいた ──
          **板ごとに5ずつ左へずれ、6枚とも左壁の裏側**（板までの距離 01=7.6 … 06=31.3 に対し
          `distance` は13）。つまり1枚も照らしていなかった。PR #19〜#21 の「まだ暗い」×3 と、
          `emissiveMap` で文字を自ら光らせた回避策（`0788372` で撤回）は、すべてこれが原因。
          **強さが作品のスポット（110）よりずっと弱い理由**: 板の地は `#efeade` のほぼ白で、
          絵の具の中間調より遥かに多く光を返す。旧来の 130 で照らすと**真っ白に飛んで
          かえって読めない**（実測済み）。34 で、作品と同じように壁へ光だまりが出て、
          数字と見出しがはっきり読める。広がり0.6は `PanelImage` の0.62と同じ考え方
          （光源から壁まで約3.5mなので、これ以上開くと間隔5mの隣の板まで照らす）。 */}
      <Spot pos={[-WALL_X + 2.6, 4.2, p.z]} target={[-WALL_X, ITEM_Y, p.z]} intensity={34} angle={0.6} />
    </>
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

// Admin-configured hero image (migration 0018). Loaded as a texture at runtime;
// until it arrives (or if it fails / CORS-blocks) the frame shows a neutral mat so
// nothing looks broken. Same shape as Framed otherwise.
function FramedImage({ src, ratio, position, rotationY = 0, w = 1.5, maxH }: { src: string; ratio: [number, number]; position: [number, number, number]; rotationY?: number; w?: number; maxH?: number }) {
  const texRef = useRef<THREE.Texture | null>(null)
  const [, bump] = useState(0)
  useEffect(() => {
    let alive = true
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      src,
      (t) => {
        if (!alive) {
          t.dispose()
          return
        }
        t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = 8
        texRef.current?.dispose()
        texRef.current = t
        bump((n) => n + 1)
      },
      undefined,
      () => {
        /* load/CORS failure — leave the neutral placeholder */
      }
    )
    return () => {
      alive = false
      texRef.current?.dispose()
      texRef.current = null
    }
  }, [src])
  const tex = texRef.current
  const [rw, rh] = ratio
  // **幅ではなく高さで頭を打つ。** `Framed` は幅を決めて高さを比率から出すので、縦長の
  // 写真を上げると額が縦に伸びて床を突き抜ける（廊下は天井 4.35 に対し中心 1.6 なので
  // 3:4 でぎりぎり、2:3 で床に着く）。呼び手が「この壁で許せる高さ」を渡し、超えたぶんは
  // 幅を縮めて収める ── 掛かる位置は変わらないので、構図の重心はそのまま。
  //
  // **収めるのは絵ではなく額の外形**（下の箱＝絵 ＋ マット `0.09w` ×2 ＋ 枠 0.12）。
  // 絵の高さで測ると額がその1〜2割はみ出す ── 大部屋の中央枠（幅7.2・中心 y=6.4）に
  // 1:2 の縦長を入れると、絵は収まっても**額の下辺が床を 0.2m 抜ける**計算だった
  // （別視点レビュー 2026-08-20）。マットは幅に比例するので、縮小率は解いて求める。
  const natural = (w * rh) / rw
  const outer = natural + 0.18 * w + 0.12
  const shrink = maxH && outer > maxH ? Math.max(0.05, (maxH - 0.12) / (natural + 0.18 * w)) : 1
  const fw = w * shrink
  const h = natural * shrink
  const mat = 0.09 * fw
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[fw + mat * 2 + 0.12, h + mat * 2 + 0.12, 0.08]} />
        <meshStandardMaterial color="#141416" roughness={0.45} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0, 0.012]}>
        <planeGeometry args={[fw + mat * 2, h + mat * 2]} />
        <meshStandardMaterial color="#e9e6dd" roughness={0.92} />
      </mesh>
      {/* Mount the art plane only once the texture exists, so its material compiles
          WITH the map. Toggling map from null→texture on a live material doesn't
          recompile the shader (no USE_MAP), which would leave the image invisible;
          the `key` forces a fresh material per source instead. */}
      {/* **絵の面は ACES を迂回する**（2026-08-20・2度目の修正）。1度目は `color="#cccccc"`
          （線形で約0.6倍・-0.7段）で albedo を落としただけだったが、**ユーザー実機で
          「どこも同じくらい白い」まま残った** ── 入口(スポット110)と大部屋(340/240)は
          光量が3倍近く違うのに一様に飛んでいたことが手がかりで、**シーンの光量に応じて
          飛び方が変わらない＝そもそも `meshStandardMaterial` で光を受けている限り、
          係数をどれだけ動かしても「ちょうどよく収まる1点」に当たる保証がない**
          （ACES のショルダーは光源側の値と albedo の積でどこまでも押し上げられる。
          -0.7段は生成アートとの差を「2〜3倍」と見積もった当てずっぽうで、実際の差を
          測っていなかった）。**係数の調整をもう一段強めるのではなく、`PanelImage` が
          既に踏んでいる解に合わせる** ── `meshBasicMaterial` ＋ `toneMapped={false}`。
          ACES にもスポットにも一切触れないので、**シーンの明るさに関係なく画像そのものの
          色がそのまま出る**（板の文字と同じ理屈。板のコメント参照）。
          代わりに絵はスポットで陰影が付かなくなる（マットと額は引き続き付く）が、
          その代償は `PanelImage` が既に払っている既知のものなので新しいリスクではない。
          生成アートの `Framed` は従来のままにしてある（あちらは飛んでいない）。 */}
      {tex && (
        <mesh key={src} position={[0, 0, 0.03]}>
          <planeGeometry args={[fw, h]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

/** 板の代わりに壁へ直接掛ける1枚（ユーザー選択 2026-08-17）。
 *  **額もマットもスポットも付けない** ── 写真そのものが訴求なので、装飾が主役を食う。
 *  位置は板と同じ `z`（カメラは `PANEL_SPOTS` の z を見に来るので、ずらすと空の壁を見る）。
 *  材質は `meshBasicMaterial` ＝ **光を要らなくする**。スポットを消したうえで
 *  `meshStandardMaterial` を使うと、暗い廊下では真っ黒にしか映らない
 *  （LESSONS「数値を大きくしても直らないときは前提を疑う」と同じ形）。
 *  `toneMapped={false}` はアップロードした写真の色をそのまま出すため
 *  （このシーンは ACES ＋ 露出1.3 なので、通すと白っぽく持ち上がる）。 */
function PanelImage({ src, ratio, z }: { src: string; ratio: [number, number]; z: number }) {
  // **テクスチャは ref ではなく state で持つ。** ref ＋ 再描画フラグにすると、`src` が
  // 差し替わったときクリーンアップが古いテクスチャを dispose しても再描画が起きず、
  // mesh が**破棄済みのテクスチャを掴んだまま**新しい画像の読み込み完了まで残る
  // （別視点レビュー 2026-08-17）。state なら null に戻した時点で必ず描き直る。
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let alive = true
    setTex(null)
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    let loaded: THREE.Texture | null = null
    loader.load(
      src,
      (t) => {
        if (!alive) {
          t.dispose()
          return
        }
        t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = 8
        loaded = t
        setTex(t)
      },
      undefined,
      () => {
        /* load/CORS failure — 何も出さない（額が無いので「空の枠」も残らない） */
      }
    )
    return () => {
      alive = false
      loaded?.dispose()
    }
  }, [src])
  // 縦横どちらの写真でも同じ「重み」で見えるよう、板より一回り大きい箱に収める
  const [rw, rh] = ratio
  const fit = Math.min(PANEL_IMG_W / rw, PANEL_IMG_H / rh)
  const w = rw * fit
  const h = rh * fit
  if (!tex) return null
  return (
    <group>
      <mesh key={src} position={[-WALL_X + 0.08, ITEM_Y, z]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {/* **光は写真ではなく壁に当てている**（ユーザー選択 2026-08-17）。写真の材質は
          `meshBasicMaterial` なので、このスポットは写真の見え方を1ミリも変えない ──
          色は撮ったままで、暗い廊下でも真っ黒にならない性質はそのまま。効くのは周りの
          壁（`meshStandardMaterial`）だけで、光だまりができることで**写真が壁に貼った
          ステッカーではなく、その空間に在るもの**に見える。
          板のスポット（130）より弱く・広くしてあるのは、「照らされた展示物」に見せたく
          ないため ── ここに写っているのは他所のギャラリーの写真で、この部屋の展示物では
          ないので、主役として照らすと入れ子になっておかしい。
          広がりは板のスポット（0.55）と同程度に留める ── 光源から壁まで約3.5mあるので、
          0.72 まで開くと光だまりが直径6mを超え、間隔5mの**隣のパネルまで照らしてしまう**。 */}
      <Spot pos={[-WALL_X + 2.6, 4.0, z]} target={[-WALL_X, ITEM_Y, z]} intensity={78} angle={0.62} />
    </group>
  )
}

/** 廊下・通路で額が収まる高さの上限。床は y=0・天井は y=4.35・作品の中心は
 *  `ITEM_Y`=1.6 なので、足元に 0.25 残す 2.7 が上限（`PANEL_IMG_H` と同じ考え方）。 */
const CORRIDOR_MAX_H = 2.7

function CorridorArt({ idx, z, side = 'R', scale = 1, src, ratio }: { idx: number; z: number; side?: 'L' | 'R'; scale?: number; src?: string; ratio?: [number, number] }) {
  const x = side === 'L' ? -WALL_X + 0.08 : WALL_X - 0.08
  const ry = side === 'L' ? Math.PI / 2 : -Math.PI / 2
  const spotX = side === 'L' ? -WALL_X + 2.6 : WALL_X - 2.6
  const wallX = side === 'L' ? -WALL_X : WALL_X
  return (
    <group>
      {src && ratio ? (
        <FramedImage src={src} ratio={ratio} position={[x, ITEM_Y, z]} rotationY={ry} w={1.5 * scale} maxH={CORRIDOR_MAX_H} />
      ) : (
        <Framed idx={idx} position={[x, ITEM_Y, z]} rotationY={ry} w={1.5 * scale} />
      )}
      <Spot pos={[spotX, 4.2, z]} target={[wallX, ITEM_Y, z]} intensity={110} />
    </group>
  )
}

// 大部屋までの「アートが並ぶ通路」 [作品index, z, 壁] — 中間セクションの背景になる。
// **並びは管理画面の枠と1対1**（lib/siteConfig の `LP_APPROACH_SLOT_LABEL_KEYS` が
// 「01 右壁」…「07 右壁」と呼ぶ順序）。`idx` は枠が空のときに出る内蔵のデモ作品。
const APPROACH_ART: [number, number, 'L' | 'R'][] = [
  [1, -46, 'R'],
  [4, -52, 'L'],
  [7, -58, 'R'],
  [2, -64, 'L'],
  [8, -70, 'R'],
  [9, -76, 'L'],
  [3, -82, 'R'],
]

/** 大部屋で額が収まる高さの上限。床は y=0・天井は y=13.6 なので、掛ける高さ `y` から
 *  「足元に 0.4 残す」「天井に 0.6 残す」の両方を満たす値を出す。縦長の写真を上げた
 *  ときだけ効く（横長は元の幅のまま）。 */
const hallMaxH = (y: number) => Math.min(2 * (y - 0.4), 2 * (13.0 - y))

// 大部屋 — 正面3枚・左右4枚は管理画面から差し替え、空の枠は内蔵のデモ作品のまま
function Hall({ front, sides }: { front: LpHeroSlot[]; sides: LpHeroSlot[] }) {
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
      {HALL_FRONT.map(([idx, x, y, w], i) => {
        const img = front[i]
        return (
          <group key={`hf${i}`}>
            {img ? (
              <FramedImage src={img.url} ratio={[img.w, img.h]} position={[x, y, HALL_FAR + 0.1]} rotationY={0} w={w} maxH={hallMaxH(y)} />
            ) : (
              <Framed idx={idx} position={[x, y, HALL_FAR + 0.1]} rotationY={0} w={w} />
            )}
            <Spot pos={[x, 12.6, HALL_FAR + 5.5]} target={[x, y, HALL_FAR]} intensity={340} angle={0.52} distance={26} />
          </group>
        )
      })}
      {/* 側壁の作品 */}
      {HALL_SIDES.map(([idx, z, w, side], i) => {
        const x = side === 'L' ? -HALL_HALF + 0.1 : HALL_HALF - 0.1
        const ry = side === 'L' ? Math.PI / 2 : -Math.PI / 2
        const sx = side === 'L' ? -HALL_HALF + 3 : HALL_HALF - 3
        const img = sides[i]
        return (
          <group key={`hs${i}`}>
            {img ? (
              <FramedImage src={img.url} ratio={[img.w, img.h]} position={[x, 5.4, z]} rotationY={ry} w={w} maxH={hallMaxH(5.4)} />
            ) : (
              <Framed idx={idx} position={[x, 5.4, z]} rotationY={ry} w={w} />
            )}
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
  for (const p of PANEL_SPOTS) walk.push({ pos: v(1.9, 1.6, p.z + 0.9), look: v(-WALL_X + 0.3, 1.5, p.z) })

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

/** 遠くの区画を、いつシーンへ足すか（0=まだ / 1=通路の作品 / 2=＋大部屋）。
 *
 *  **最初の描画では、通路（z=-46 以遠）も大部屋（z=-88 以遠）も一枚も見えない** ──
 *  霧が `far=38` なので、入口（カメラ z=+7.4）から見えるのは z=-30 あたりまで。
 *  それなのに、そこにある**14枚の生成アート（720px）を初回描画と同じ時間に焼いていた**。
 *  いちばん混んでいる時間帯に、見えないもののために100MB近いテクスチャを作っていたことになる。
 *
 *  ブラウザが暇になってから2段に分けて足す（14枚を一度に焼くと、その瞬間に長い停止が入る）。
 *  **スクロールが先に進んだら待たない** ── 再訪や `#pricing` 付きのURLで下から始まる場合、
 *  暇になるのを待っていると空の空間が見えてしまう。
 *
 *  **スクロール側のしきい値は段ごとに別に置く。**
 *  ここを「0.5画面ぶん」のような手前に共通で置くと、**暇になるのを待たずに14枚を一度に
 *  焼いてしまい、歩き始めたその瞬間にカクつく**（2段に分けた意味が消える。別視点レビュー
 *  2026-08-18）。逆に遅すぎると、速くスクロールした人に**空の廊下**が見えてしまう。
 *  境界は霧（`far=38`）から引く:
 *   - 通路の最初の作品（z=-46）が霧に入るのはカメラが z=-8 を過ぎたあたり ＝ 廊下の
 *     歩行区間（`corEnd * 0.82`。`buildAnchors` と同じ式）の **約37%**。→ しきい値 35%。
 *   - 大部屋の入口（z=-88）が霧に入るのはカメラ z=-50 ＝ 廊下を抜けたあと。
 *     → しきい値は `corEnd` の 90%（そこでカメラは z≈-33 で、入口まで55ありまだ霧の中）。 */
const FAR_APPROACH_RATIO = 0.35
const FAR_HALL_RATIO = 0.9

/** しきい値そのもの（スクロール位置のpx）。**測るのは一度だけ**にする ──
 *  `offsetTop` / `offsetHeight` はスクロール中に読むと強制同期レイアウトを起こすので、
 *  スクロールのたびに読むと**いちばんカクついてほしくない場面で自分がカクつかせる**
 *  （このファイルの `recompute()` が同じ理由でリサイズ時にしか測っていない）。
 *  `features` がまだ測れない初回描画では、画面1つぶんを控えめな代わりにする。 */
function measureFarThresholds(): { approach: number; hall: number } {
  const vh = window.innerHeight || 1
  const feat = document.getElementById('features')
  if (!feat) return { approach: vh, hall: vh }
  const corEnd = feat.offsetTop + feat.offsetHeight - vh
  const walkSpan = Math.max(1, corEnd * 0.82)
  return { approach: walkSpan * FAR_APPROACH_RATIO, hall: corEnd * FAR_HALL_RATIO }
}

/** いまのスクロール位置が要求する最小の段。 */
function stepRequiredByScroll(at: { approach: number; hall: number }): number {
  const y = window.scrollY
  if (y > at.hall) return 2
  if (y > at.approach) return 1
  return 0
}

function useFarSections(): number {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (step >= 2) return
    let cancelled = false
    const bump = () => {
      if (!cancelled) setStep((n) => Math.max(n, step + 1))
    }
    // スクロールが先に進んでいるなら、暇を待たずにそこまで出す（再訪・`#pricing` 付きのURL）
    let at = measureFarThresholds()
    const need = stepRequiredByScroll(at)
    if (need > step) {
      setStep(need)
      return
    }
    const onScroll = () => {
      const n = stepRequiredByScroll(at)
      if (n > step) setStep(n)
    }
    const onResize = () => {
      at = measureFarThresholds()
      onScroll()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    const ric = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback : null
    const id = ric ? ric(bump, { timeout: 2500 }) : window.setTimeout(bump, 900)
    return () => {
      cancelled = true
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      if (ric) window.cancelIdleCallback(id as number)
      else window.clearTimeout(id as number)
    }
  }, [step])
  return step
}

function Scene({ faces, panels }: { faces: LpFaces; panels: PanelText[] }) {
  // スポットライトの登録簿。`Spot` が積み、`SpotPool` が毎フレーム読む
  const spots = useMemo<SpotDef[]>(() => [], [])
  const far = useFarSections()
  return (
    <SpotRegistry.Provider value={spots}>
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
        {SMALL_SCREEN ? (
          // Phones skip the reflector: it re-renders the scene to a render target
          // every frame, the single biggest GPU/battery cost on the page
          <meshStandardMaterial color="#0b0b0c" metalness={0.5} roughness={0.93} />
        ) : (
          <MeshReflectorMaterial
            blur={[300, 100]}
            resolution={256}
            mixBlur={1}
            mixStrength={13}
            roughness={0.93}
            depthScale={1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
            color="#0b0b0c"
            metalness={0.5}
          />
        )}
      </mesh>

      {HERO_SLOTS.map((s, k) => {
        const img = faces.hero[k]
        return (
          <CorridorArt
            key={`h${k}`}
            idx={s.idx}
            z={s.z}
            scale={s.scale}
            src={img?.url}
            ratio={img ? [img.w, img.h] : undefined}
          />
        )
      })}
      {far >= 1 &&
        APPROACH_ART.map(([idx, z, side], k) => {
          const img = faces.approach[k]
          return (
            <CorridorArt
              key={`ap${k}`}
              idx={idx}
              z={z}
              side={side}
              scale={1.15}
              src={img?.url}
              ratio={img ? [img.w, img.h] : undefined}
            />
          )
        })}
      {panels.map((p, k) => {
        const art = faces.panels[k]
        // 写真が入っている枠は**写真だけ**にする（ユーザー選択 2026-08-17）。
        // 以前は板と写真が横に並んでいたが、同じことを二度言っている状態だった。
        // 文言は3D非対応向けの `.corridor-fallback`（app/page.tsx）に本物の見出しとして
        // 残っているので、クローラーと読み上げからは消えない。
        return (
          <group key={p.n}>
            {art ? (
              <PanelImage src={art.url} ratio={[art.w, art.h]} z={p.z} />
            ) : (
              <Panel p={p} />
            )}
          </group>
        )
      })}
      {far >= 2 && <Hall front={faces.hallFront} sides={faces.hallSides} />}
      <SpotPool />
      <Dust />
      <Rig />
      <ViewAdaptor />
    </SpotRegistry.Provider>
  )
}

export default function HeroScene({ onContextLost }: { onContextLost: () => void }) {
  const [hud, setHud] = useState<Hud | null>(null)
  const [hudOn, setHudOn] = useState(false)
  // Stop the render loop entirely while the tab is hidden (battery)
  const [halted, setHalted] = useState(false)
  // Wall/label textures bake fonts into canvases once — wait for the webfonts
  // (with a cap) so museum labels don't ship in a fallback serif forever
  const [fontsReady, setFontsReady] = useState(false)
  // Admin-configured art for all five faces (migration 0018); nulls fall back to the
  // demo art — except the corridor panels, where an empty slot leaves the text board
  const faces = useLpFaces()
  // 文言は辞書から。壁のテクスチャは1枚ずつ canvas に焼くので、配列そのものを
  // memo して同一性を保つ（スクロールごとの再描画で焼き直させない）。
  const t = useT()
  const panels = useMemo<PanelText[]>(
    () =>
      PANEL_SPOTS.map((s) => ({ n: s.n, z: s.z, h: t(`lp.${s.k}Title`), b: t(`lp.${s.k}Body`) })),
    [t],
  )
  const hudStops = useMemo(() => buildHud(t, panels), [t, panels])

  useEffect(() => {
    const onVis = () => setHalted(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    let alive = true
    void Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => {
      if (alive) setFontsReady(true)
    })
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

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

    const walkLen = HERO_ART.length + PANEL_SPOTS.length
    const onScroll = () => {
      const y = window.scrollY
      const walkSpan = dims.corEnd * 0.82
      if (y < walkSpan) {
        const idx = Math.min(walkLen - 1, Math.max(0, Math.round((y / Math.max(1, walkSpan)) * (walkLen - 1))))
        setHud(hudStops[idx])
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
  }, [hudStops])

  return (
    <div className="hero-canvas" aria-hidden="true">
      <Canvas
        frameloop={halted ? 'never' : 'always'}
        dpr={[1, SMALL_SCREEN ? 1.25 : 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 48, position: [-1.7, 1.66, 7.4], near: 0.1, far: 160 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.3
          // iOS Safari drops the WebGL context on app-switch/memory pressure. three's
          // own WebGLRenderer already calls preventDefault() here and will attempt to
          // reinitialize on `webglcontextrestored` (re-uploading every texture) — we
          // can't rely on that being suppressed. So instead of trying to rebuild in
          // place like the gallery (GalleryApp.tsx), we unmount immediately: the
          // parent (HeroCanvas) disposes this Canvas on the next render, which tears
          // the renderer down before any restore-driven reinitialization can matter,
          // and falls back to the static CSS art instead of re-decoding ~150MB of
          // hero textures right as memory is already under pressure.
          gl.domElement.addEventListener(
            'webglcontextlost',
            (e) => {
              e.preventDefault()
              track('lp_context_lost', { mobile: SMALL_SCREEN })
              onContextLost()
            },
            { once: true }
          )
        }}
      >
        {fontsReady && <Scene faces={faces} panels={panels} />}
      </Canvas>
      <div className="hero-grade" aria-hidden="true" />
      <div className={`journey-hud${hudOn ? ' on' : ''}`}>
        <div className="journey-hud-inner" key={(hud?.eyebrow || '') + (hud?.title || '')}>
          <span className="journey-hud-eyebrow">{hud?.eyebrow}</span>
          <p className="journey-hud-title">{hud?.title}</p>
          {hud?.body && <p className="journey-hud-desc">{hud.body}</p>}
        </div>
      </div>
    </div>
  )
}
