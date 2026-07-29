---
name: preview-verify
description: プレビュー（ブラウザペイン）でUIや3Dを実測する前に読むスキル。「スクリーンショットが真っ黒」「getComputedStyle が古い値を返す」「クリックが効かない」「ページのグローバル変数が見えない」「@media (pointer:coarse) が再現されない」など、検証ツール側の制約を実装のバグと誤診しかけたときに使う。3Dギャラリー・LPヒーロー・canvasに焼いたテクスチャの検証、認証が要る画面（/me・/admin）の幾何確認にも使う。
---

# preview-verify — プレビューで測る前に

## なぜこのスキルがあるか

このリポジトリでは **「検証ツールに嘘をつかれて、実装のバグだと誤診する」が ×6 起きた**（/kaizen 昇格 2026-07-29）。毎回10分〜数時間を溶かし、**1回は誤診に基づいて別のバグを作った**。ユーザーは非エンジニアで本番の唯一のQAなので、未検証・誤検証のまま「修正しました」と報告すると本番での手戻りに直結する。

原則は1つ: **測った値が理屈と食い違ったら、まず測り方を疑う。**

## 測る前の前提チェック（3行で済む）

```js
// javascript_tool で最初に流す
JSON.stringify({
  hidden: document.hidden,                                   // true なら描画が止まっている
  size: (() => { const c = document.querySelector('canvas'); return c && { w: c.width, h: c.height, cw: c.clientWidth } })(),
  fonts: document.fonts.status,                              // canvas に焼く文字は loaded を待つ
})
```

- **`document.hidden === true` なら何も測れない。** ペインが前面に無いとブラウザがレイアウト・スタイル再計算・rAF を止める。3Dは `frameloop` を `never` にする実装（電池対策）なので**本当に描画していない** → スクリーンショットは真っ黒、`canvas.width` は既定の `300x150` のまま、`clientWidth` は 0。
  - 対処: `computer{action:"screenshot"}` か `tabs_select` で**前面に出してから**測る。`navigate` → `screenshot` → 測定 の順にする。
  - 隠れたペインでは `setTimeout` も強くスロットルされる。**1回の実行に複数の待ちを入れると30秒でタイムアウトする**（1往復1操作に割る）。
- **`window.scrollTo()` は `behavior: 'instant'` を明示する。** このリポジトリの LP は `scroll-behavior: smooth` なので、既定だと直後に `scrollY` を読んでも古い値が返る。

## 何を信用するか（矛盾したときの優先順位）

```
スクリーンショット  ＞  getBoundingClientRect()  ＞  getComputedStyle()
```

- `getComputedStyle` は**インラインで値を入れても古い値を返し続ける**ことがある（×2）。「宣言が当たっているか」を computed style で確かめようとせず、**レイアウトの結果**で判定する（例: 折り返しているか＝各行の `top` が同じか）。
- `document.styleSheets` の走査はペインで空を返すことがある。**配信されているCSSに本当に入っているか**は `curl -s <url>/_next/static/css/… | grep <selector>` が最速で確実。
- 画面外へのはみ出しは `document.scrollWidth` では検出できない（`overflow-x: hidden` があるとページ幅は正常値を返す）。**要素ごとに `rect.right > innerWidth` を見る。**

## ツールの制約と回避策

| 症状 | 正体 | 回避策 |
|---|---|---|
| ページのグローバル変数（`window.__foo`）が見えない | `javascript_tool` は **isolated world** で動く。DOMは共有するがJSのグローバルは別 | 値を**DOMに逃がす**。画面外の `<div>` に `appendChild` し、数値は `dataset` にJSONで書く |
| canvasに焼いた文字を検証したい | WebGLテクスチャの中身は外から読めない | canvas を DOM に置けば `getImageData` で**インクの外接矩形**まで測れる。スクリーンショットより強い証拠になる |
| `computer` のクリックが効かない | 合成クリックが React に届かないことがある | `element.click()` / `dispatchEvent(new MouseEvent('click',{bubbles:true}))` で切り分ける。動けば実装は正しい |
| `@media (pointer: coarse)` が効かない | ペインは coarse pointer をエミュレートしない | `document.styleSheets` から該当 `CSSMediaRule` の `cssRules` を取り出し、**メディア指定を外して `<style>` に再注入**して測る（手打ちでコピーせず出荷される宣言そのものを使う） |
| `env(safe-area-inset-*)` が常に 0 | ペインにノッチが無い | 実機QAへ回す。**検証できなかったことを報告に明記する** |
| console に古い構文エラーが残る | `read_console_messages` は**累積バッファ** | 存在しない行番号を指していたら過去の保存の残骸。健全性は `tsc --noEmit` と実描画で判断する |
| 認証が要る画面（`/me` `/admin`）が開けない | ローカルに Supabase の鍵が無い | 同じクラス構成の**合成DOM**を `document.body` に足して幾何を測る。ページ本体の最終QAはユーザーに委ねる |

## React の状態を測るとき

**イベント発火と結果の確認は別の tool 呼び出しに分ける。** 同じJS実行内で「発火 → DOMを読む」と必ず更新前の値が見える（React の更新は非同期）。

## 報告のしかた

- 検証できなかったものは**黙って「確認済み」にしない**。何が確認でき、何が実機QA待ちかを分けて書く。
- 「変更前でも同じか」を1回確かめる（`git stash`）。プレビューの異常は変更と無関係なことがある。

## 関連

- docs/LESSONS.md「検証・ツール」— 個々の事例と実測値
- .claude/skills/kaizen — この手の再発を数えて昇格させる仕組み
- ship スキル 2.6 / 2.7 — UI変更の実測検証と preview の限界
