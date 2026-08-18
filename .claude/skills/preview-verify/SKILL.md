---
name: preview-verify
description: プレビュー（ブラウザペイン）でUIや3Dを実測する前に読むスキル。「スクリーンショットが真っ黒」「getComputedStyle が古い値を返す」「クリックが効かない」「ページのグローバル変数が見えない」「@media (pointer:coarse) が再現されない」など、検証ツール側の制約を実装のバグと誤診しかけたときに使う。アクセシビリティ監査やUXレビューで「閾値を割った要素」を見つけたときの過剰報告の防ぎ方、認証が要る画面（/me・/admin）を実バンドルして本物の操作で検証する手順も含む。3Dギャラリー・LPヒーロー・canvasに焼いたテクスチャの検証にも使う。
---

# preview-verify — プレビューで測る前に

## なぜこのスキルがあるか

このリポジトリでは **「検証ツールに嘘をつかれて、実装のバグだと誤診する」が ×10 起きた**（/kaizen 昇格 2026-07-29 の時点で ×6。**昇格後も ×7 → ×10 と増え続けている**）。毎回10分〜数時間を溶かし、**2回は誤診に基づいて別のバグを作った**。ユーザーは非エンジニアで本番の唯一のQAなので、未検証・誤検証のまま「修正しました」と報告すると本番での手戻りに直結する。

原則は2つ:

1. **測った値が理屈と食い違ったら、まず測り方を疑う。**
2. **測った値が閾値を割っていても、それが何を意味するかまで確かめてから報告する。**（2026-08-12 追加。1回のUXレビューで**5件の過剰報告を出しかけ、1件は基準に従って直したつもりで基準より重い不具合を作った**）

## 測る前の前提チェック（3行で済む）

```js
// javascript_tool で最初に流す
JSON.stringify({
  path: location.pathname,                                   // ★測るつもりのページに本当にいるか
  hidden: document.hidden,                                   // true なら描画が止まっている
  size: (() => { const c = document.querySelector('canvas'); return c && { w: c.width, h: c.height, cw: c.clientWidth } })(),
  fonts: document.fonts.status,                              // canvas に焼く文字は loaded を待つ
})
```

- **`location.pathname` を毎回見る。ペインは勝手に別のURLへ戻ることがある。**（2026-08-12）`/demo` を測ったつもりの数字が、実はLPの数字だった（`nav-logo` や `price-badge` が結果に混ざって初めて気づいた）。`navigate` の戻り値はパスを省略して `http://localhost:5173` と報告するので、**戻り値では確認できない**。
  - 対処: **測る関数の1行目でパスを検証し、違えば中断する。**
    ```js
    if (!/demo/.test(location.pathname)) return JSON.stringify({ ABORT: location.pathname })
    ```

- **`document.hidden === true` なら何も測れない。** ペインが前面に無いとブラウザがレイアウト・スタイル再計算・rAF を止める。3Dは `frameloop` を `never` にする実装（電池対策）なので**本当に描画していない** → スクリーンショットは真っ黒、`canvas.width` は既定の `300x150` のまま、`clientWidth` は 0。
  - 対処: `computer{action:"screenshot"}` か `tabs_select` で**前面に出してから**測る。`navigate` → `screenshot` → 測定 の順にする。
  - 隠れたペインでは `setTimeout` も強くスロットルされる。**1回の実行に複数の待ちを入れると30秒でタイムアウトする**（1往復1操作に割る）。
  - **`tabs_select` も `screenshot` も、前面にするのは「その1呼び出しの間だけ」。** 呼び出しが終わると `document.hidden` は即 `true` に戻り、次の tool 呼び出しまでの間フレームは**1枚も進まない**（`computer{action:"wait"}` でも進まない ── 実測 0 フレーム）。**進むのはスクリーンショット1回あたり約5フレーム。**
  - **だから「1フレームに1つずつ進める状態機械」は、測ると必ず途中で止まって見える**（2026-08-18・×11。焼き込みが `idx=4/10` で止まって見え、実装のバグだと10分疑った。実際は正常で、フレームが来ていなかっただけ）。
    - **見分け方: `setTimeout` ではなく `requestAnimationFrame` で数える。** 経過時間ではなく**進んだフレーム数**を記録すれば、「止まっている」と「フレームが来ていない」が一目で分かる。
    - **進めたいときは、低倍率のスクリーンショットを必要な回数だけ連射する**（`computer{action:"screenshot", scale:0.12}` は 96×54 なので文脈を食わない）。N作品の焼き込みは 2N フレーム＝スクショ約 2N/5 回。
- **`window.scrollTo()` は `behavior: 'instant'` を明示する。** このリポジトリの LP は `scroll-behavior: smooth` なので、既定だと直後に `scrollY` を読んでも古い値が返る。

## 何を信用するか（矛盾したときの優先順位）

```
スクリーンショット  ＞  getBoundingClientRect()  ＞  getComputedStyle()
```

- `getComputedStyle` は**インラインで値を入れても古い値を返し続ける**ことがある（×2）。「宣言が当たっているか」を computed style で確かめようとせず、**レイアウトの結果**で判定する（例: 折り返しているか＝各行の `top` が同じか）。
- `document.styleSheets` の走査はペインで空を返すことがある。**配信されているCSSに本当に入っているか**は `curl -s <url>/_next/static/css/… | grep <selector>` が最速で確実。
- 画面外へのはみ出しは `document.scrollWidth` では検出できない（`overflow-x: hidden` があるとページ幅は正常値を返す）。**要素ごとに `rect.right > innerWidth` を見る。**
- **SVGの中の数値は CSS px ではない。** `getComputedStyle(svgText).fontSize` が「0.6px」を返しても、`viewBox` のスケールが掛かって実際は約8pxで描かれている（2026-08-12。`pe-slot-num` で誤読しかけた）。**`viewBox` の幅と描画幅の比を掛けてから px と比べる。**
- **自動で消えるUIは、消えた後を読んでいる可能性がある。** トースト（`lib/toast` は **4600ms** で自分を消す）・スナックバー・一時的なハイライトは、ツールの1往復がその寿命より長い。「出ていない」と読めても実装は正しいことがある（2026-08-12。上限超過のトーストで実際に誤読した）。
  - 対処: **発火の前に `MutationObserver` で記録を仕込み、あとから記録を読む。**
    ```js
    window.__log = []
    new MutationObserver(() => { const m = el.dataset.msg || el.textContent; if (m) window.__log.push(m) })
      .observe(el, { attributes: true, childList: true, subtree: true, characterData: true })
    ```

## ツールの制約と回避策

| 症状 | 正体 | 回避策 |
|---|---|---|
| ページのグローバル変数（`window.__foo`）が見えない | `javascript_tool` は **isolated world** で動く。DOMは共有するがJSのグローバルは別 | 値を**DOMに逃がす**。画面外の `<div>` に `appendChild` し、数値は `dataset` にJSONで書く |
| canvasに焼いた文字を検証したい | WebGLテクスチャの中身は外から読めない | canvas を DOM に置けば `getImageData` で**インクの外接矩形**まで測れる。スクリーンショットより強い証拠になる |
| `computer` のクリックが効かない | 合成クリックが React に届かないことがある | `element.click()` / `dispatchEvent(new MouseEvent('click',{bubbles:true}))` で切り分ける。動けば実装は正しい |
| `@media (pointer: coarse)` が効かない | ペインは coarse pointer をエミュレートしない | `document.styleSheets` から該当 `CSSMediaRule` の `cssRules` を取り出し、**メディア指定を外して `<style>` に再注入**して測る（手打ちでコピーせず出荷される宣言そのものを使う） |
| `env(safe-area-inset-*)` が常に 0 | ペインにノッチが無い | 実機QAへ回す。**検証できなかったことを報告に明記する** |
| console に古い構文エラーが残る | `read_console_messages` は**累積バッファ** | 存在しない行番号を指していたら過去の保存の残骸。健全性は `tsc --noEmit` と実描画で判断する |
| 認証が要る画面（`/me` `/admin`）が開けない | ローカルに Supabase の鍵が無い | 幾何だけなら合成DOMで足りる。**操作性まで見るなら実バンドル**（下の専用節）。ページ本体の最終QAはユーザーに委ねる |
| フォームが「Supabaseが未設定です」で描かれない | `lib/supabase` が `null` だと分岐で早期return する | `.env.local` にダミー値を書けば描画される（`.gitignore` の `.env*` 対象なのでコミットされない）。**検証後に消す**。送信は失敗するが、送信前のUIと入力検証は本物で測れる |

## 閾値を割った要素を見つけたとき（過剰報告を防ぐ）

2026-08-12 のUXレビューで、機械的な閾値だけで数えて **5件の「不具合」を報告しかけ、全部こちらの測り方の問題だった**。閾値を割った要素は「報告候補」でしかない。**下の5つを当ててから報告する。**

1. **スクロールできる親の中か。** `rect.right > innerWidth` は横スクロール領域の中身も拾う（作品トレイやタブ列で17件出た）。親を辿って `overflowX` が `auto`/`scroll` なら、それは意図した設計。
   ```js
   const inScroller = el => { let n = el.parentElement; while (n && n !== document.body) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; n = n.parentElement } return false }
   ```
2. **タップ領域は視覚サイズと違うことがある。** 配置スロットは見た目25pxだが、実装が隣との距離から当たり判定を **28〜57px** に広げていた。**`elementFromPoint` を中心から外へ走らせて実効サイズを測る。**
   ```js
   const reach = (dx, dy) => { for (let d = 0; d < 40; d++) { const e = document.elementFromPoint(cx + dx*d, cy + dy*d); if (!e || !e.closest(sel)) return d } return 40 }
   ```
3. **WCAG 2.2 SC 2.5.8 には間隔による例外がある。** 24px未満でも、**中心間距離が24px以上**なら適合。21pxのスウォッチ（28px間隔）と18pxの削除ボタン（229px離れ）はこれで適合だった。**例外が使えないのは、対象が別の対象に重なっているとき**（タイルの上に乗った✕など）。
4. **要素の箱と、文字のインクは別。** 「23×36px重なっている」は要素同士の話で、実際に隠れた**文字**は4pxだけ・しかも55%透過の下だった。テキストの重なりは子要素の `getBoundingClientRect` の最大 `right` で測る。
5. **`pointer-events: none` なら操作は奪われていない。** ミニマップとステッパーが32×4px重なっていたが、ミニマップは表示専用なので**見た目だけ**の話だった。重なりを報告する前に両者の `pointerEvents` を見る。

### 基準を満たすための変更が、基準より重い不具合を作ることがある

✕ボタン（15×15px）を24pxにしようとして、**タイルの中心が削除ボタンになった**（`overflow: hidden` で外側が切られるため内側へ広げたら、47pxのタイルでは中心まで届いた。中央タップで作品が消えるのを実測して撤回）。

- **小さいタイルの角に置いたボタンの当たり判定は、タイル自身のサイズが天井になる。** 必要条件は `tile/2 > tile − (offset + target)`。
- 広げる前に「**器を大きくする**／ボタンを外に出す」を検討する。実際の解決は「狭い幅で列数を減らしてタイルを60pxにしてから判定を広げる」だった。
- **直したら必ず、副作用の側を測る。** この件は `elementFromPoint(タイル中心)` が `BUTTON` を返すかで一発で分かった。

## 認証が要る画面を、実物のコンポーネントで検証する

合成DOMでは幾何しか見られない。**実物を実バンドルすれば、本物のポインタ／キーボード操作まで検証できる**（2026-08-12 に `/me` の全5タブと配置エディタで実施）。

1. **エントリはリポジトリ内**に置く（`node_modules` を解決させるため。外に置くと `react` が見つからない）。
2. バンドル:
   ```bash
   npx --yes esbuild@0.24.0 tmp-ux/entry.tsx --bundle --outfile=public/uxcheck.js \
     --alias:@=. --loader:.tsx=tsx --jsx=automatic --format=iife \
     --define:process.env.NODE_ENV='"development"' \
     --banner:js='globalThis.process=globalThis.process||{env:{NODE_ENV:"development"}};'
   ```
   **`--banner:js` の `process` シムは必須**（無いと `process is not defined` で何も描かれない。`--define` だけでは足りない）。
3. **CSSは `app/layout.tsx` と同じ import 順**で `<style>` に連結する（順序を変えると効くルールが変わる）。`public/` に置いて dev サーバーから配信。
4. **非exportのコンポーネントは、元ファイルを触らずコピーに export を1行足す**（`cp app/me/page.tsx tmp-ux/page-copy.tsx` → 末尾に `export { GalleryCard as ... }`）。元ファイルを編集して戻し忘れる事故を作らない。
5. ストアに合成データを入れる（`useGallery.setState({ user, cloudArtworks, profileUsername })`）。**型の全フィールドを埋める** — `ArtworkData.ratio` が無いだけで描画前に落ちた。
6. 検証後は **`public/` の生成物と一時ディレクトリを消してから番人を回す**（未追跡ファイルで番人自身が落ちる）。

## React の状態を測るとき

**イベント発火と結果の確認は別の tool 呼び出しに分ける。** 同じJS実行内で「発火 → DOMを読む」と必ず更新前の値が見える（React の更新は非同期）。

## 報告のしかた

- 検証できなかったものは**黙って「確認済み」にしない**。何が確認でき、何が実機QA待ちかを分けて書く。
- **「変更前でも同じか」を1回確かめる（`git stash`）。プレビューの異常は変更と無関係なことがある。** 2026-08-12 にこれが効いた ── トークン統合の直後に見出しが23pxはみ出しているのを見つけたが、stash して測ったら**変更前と同じ位置**で、無関係の既存バグだった。測らなければ「自分の変更のせい」と誤診し、**直したばかりの修正を戻していた**。
- **止めた過剰報告も報告する。** 「閾値を割っていたが例外に当たるので問題なし」と書くと、数字が信用できることの証拠になる（ユーザーは非エンジニアなので、何件見て何件が本物だったかが判断材料になる）。

## 関連

- docs/LESSONS.md「検証・ツール」— 個々の事例と実測値
- .claude/skills/kaizen — この手の再発を数えて昇格させる仕組み
- ship スキル 2.6 / 2.7 — UI変更の実測検証と preview の限界
