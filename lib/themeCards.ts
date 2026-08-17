// テーマカードの写真（`public/themes/{key}.jpg`）についての唯一の定義。
//
// 何のためか: ダッシュボードのテーマ選択は「選ぶ前に見える」ための場所で、値を動かす
// 場所ではない（動かす場所＝Design Tools は隣の大プレビューが受け持つ）。テーマは固定の
// 少数なので、**実際のレンダラで焼いた写真を貼る方が、GPU を使わずに実写が出せる**
// （ユーザー選択 2026-08-17）。
//
// 焼き直しの手順は `npm run check:theme-images` が落ちたときに表示する。
// 焼く画面は `/theme-capture`（開発時のみ・本番は 404）。

/** 焼くときの**CSS上の**寸法。実際のファイルはここに `devicePixelRatio`（上限1.5）が
 *  掛かるので、Retina で焼くと 720×300*1.5=450 になる（いま入っているのがこれ）。
 *  比率 8:5 は変わらないので、どちらで焼いてもカードの見た目とレイアウトは同じ。 */
export const THEME_CARD_W = 480
export const THEME_CARD_H = 300

/** そのテーマの写真の場所。無い場合でも参照は同じ形にしておく（番人が存在を保証する）。 */
export function themeCardSrc(themeKey: string): string {
  return `/themes/${themeKey}.jpg`
}
