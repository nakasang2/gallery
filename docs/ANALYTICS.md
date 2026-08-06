# ANALYTICS.md — 計測ポイントの棚卸し（実装前の設計メモ）

> 目的: **このコードベースのどこに何を差せるか**の全量と、その中から実装したものの記録。
> ユーザー指示 2026-08-06「ビジターのギャラリー内での行動は結構細かく／出展者も」→「gaがいいな」。
> §3〜§4 の表は**採用・不採用を問わない全量カタログ**（優先度つき）。何が実装済みかは §0.4 と §8。

---

## 0. 決定: Google Analytics 4（ユーザー判断 2026-08-06「gaがいいな」）

計測手段は **GA4（gtag.js）** に確定。`NEXT_PUBLIC_GA_ID` が未設定のときは**何も読み込まず何も送らない**（ローカル・プレビュー・fork が本番プロパティを汚さない。Stripe/OpenAI が鍵なしで501を返すのと同じ規律）。

### 0.1 この選択に伴って必ず起きること

| 事項 | 状態 |
|---|---|
| プライバシーポリシーの改訂 | **実施済み**（§1に計測内容、§3に処理者としてGoogle、§8にCookieの記述。「第三者アナリティクスを使わない」の一文は削除した — 実装と食い違う文言を残すのは最悪） |
| EEA/UK/CH の同意 | **Consent Mode v2 の地域別デフォルトで `analytics_storage: denied`**。当該地域ではCookieを置かずクッキーレス計測になる。広告系（`ad_storage` 等）は**全地域で常時denied** |
| 同意バナー | **未実装**。`grantAnalyticsConsent()` という呼び口だけ用意してある（`lib/analytics.ts`）。バナーを出すまでEEAは推計値のまま＝**ユーザー判断待ち** |
| 広告連携 | 使わない。GA4管理画面で **Google シグナル と 広告向けデータ共有はオフのままにすること**（コード側では止められない） |

### 0.2 GA4 で「できないこと」（設計に効く制約）

1. **作家向けの数字には使えない。** `/me` の訪問数・♡は今後も Supabase の `visits`/`likes` が出どころ。GA4のデータは自分のDBに戻ってこないので、「あなたの作品でこれが一番見られました」を作家に見せたくなった時点で、**その集計だけは別途DBに持つ工事が要る**（本ドキュメント §6.2 の `events` テーブル案は捨てずに残してある）。
2. **広告ブロッカーで落ちる。** gtag.js は素直にブロックされる。ここで出る数字は**下限であって全数ではない**。`visits` テーブル（自前・ブロックされない）と突き合わせると、実際の欠測率が測れる。
3. **高カーディナリティは潰れる。** `artwork_id` のような値はGA4の標準レポートで `(other)` に丸められることがある。作品別ランキングを真面目にやるなら BigQuery エクスポート（無料枠で可）を有効にすること。
4. **カスタムパラメータは登録するまでレポートに出ない。** 管理→カスタム定義でイベントスコープのカスタムディメンションとして登録が必要（上限50）。登録前でもBigQueryには入っている。

### 0.3 イベント名の規約（GA4準拠）

GA4のイベント名は **`[A-Za-z][A-Za-z0-9_]{0,39}`** で、**ドットは使えない**。本ドキュメントが当初使っていた `gallery.work.focus` 記法は、実装では **`gallery_work_focus`** というスネークケースになっている。以下の表の名前は読みやすさのためドット記法のままだが、**コード上の正はスネークケース**（`lib/analytics.ts` が不正名を実行時に弾いてconsoleに出す）。

パラメータは共通で `gallery_id` / `surface` / `embed` / `works` を付与。GA4の上限（1イベント25個・値100文字）は `track()` が機械的に切り詰める。

### 0.4 実装済みの範囲

第1弾として **39イベント**を実装済み（`git log` の `feat(analytics)`）。内訳は §7 の推奨セットに加えて、検証中に安く取れると分かったものを足したもの。**未実装は §3〜§4 の ★★ 以下の多く**（移動ヒートマップの本格運用、動画再生、音声ガイド、`/explore` と LP の細目、アカウント削除）。

## 1. 現状すでに測れているもの / 測れていないもの

### 測れている（3種類だけ）

| 何 | どこ | 粒度 | 出口 |
|---|---|---|---|
| 訪問 | `lib/engagement.ts:10` `recordVisit()` → `visits` テーブル | **1タブセッション1件**（`sessionStorage` で dedupe） | `/me` の「訪問数」`app/me/page.tsx:1760`、`/admin`、3Dの past-visitor ゴースト |
| ♡ | `lib/engagement.ts:39` `addLike()` → `likes` | 作品ごと・1ブラウザ1回（`localStorage`） | `/me` のサマリ、作品パネルのカウント |
| 芳名帳 | `lib/engagement.ts:88` → `guestbook` | 投稿ごと | `/me` の公開ステージ |

集計は `engagementSummary()`（`lib/engagement.ts:110`）が visits / likes / guestbook の **3つの総数** を返すだけ。時系列も内訳も無い。

### 測れていない（＝今回の本題）

- **どの作品が見られたか**。作品単位のビューが1件も無い。♡ は「押した人」しか映さないので、母数が無く率が出せない。
- **滞在時間**。入場も退場も記録していない。
- **部屋の中で何が起きたか**。歩いたのかツアーに任せたのか、ステッパーで飛ばしたのか、途中で諦めたのか。
- **入場に失敗した人**。WebGLが無い（`GalleryApp.tsx:182` → `:367` `FlatGallery`）、コンテキストロスト（同 :277）、ロードが12秒でタイムアウト（同 :243）— **全部サイレント**。ここが一番怖い。「訪問数は出てるのに反応が無い」の正体が実は真っ黒画面、という可能性を今は否定できない。
- **出展者の離脱地点**。サインアップからギャラリー公開までに5ステージあるが、どこで止まったかが分からない。
- **課金ファネル**。購入モーダルを開いた数も、Stripeへ飛んだ数も分からない。分かるのは `purchases` に行が入った**成功だけ**。

---

## 2. 実装アーキテクチャ（差し込む場所の設計）

### 2.1 中心に置くもの: ストア購読が1本で大量に取れる

`lib/store.ts` の zustand ストアは、ビジターのUI状態をほぼ全部持っている。**`useGallery.subscribe` を1本張るだけで**以下が丸ごと取れる（`RecordButton.tsx` が既に同じ手を使っている）:

- `focusedIndex` — 作品にフォーカスした／外した（**作品ビューと滞在時間の主計測点**）
- `tourActive` / `tourRecording` — ガイドツアー開始・終了・録画
- `settingsOpen` / `guestbookOpen` / `infoOpen` — 各パネルの開閉
- `visitor` — 入退場（visitor が入る＝入場、null に戻る＝退場）

個別のコンポーネントに `track()` を散らすより、**`components/gallery/AnalyticsProbe.tsx`（描画しないクライアントコンポーネント）を1枚作って `GalleryApp` に置く**のが、既存コードを汚さず番人にも引っかからない。散らすのは「ストアを経由しない行為」だけでよい（♡・共有・録画・音声ガイド・購入）。

### 2.2 高頻度なもの: React の外にある

移動と視線は毎フレーム更新で、意図的に React の再描画経路から外してある（`WalkControls.tsx` 冒頭のコメント）。カメラ姿勢は `lib/controller.ts` の `camPose`（`WalkControls.tsx:534-537` で毎フレーム publish）にあるので、**1秒間隔のサンプラで `camPose` を読む**のが正しい。`useFrame` の中で track を呼んではいけない。

### 2.3 送信（GA4採用後）

自前でバッチを組む必要は無くなった。gtag.js が送信の面倒を見る（GA4は既定で `sendBeacon` を使うので、退場時のイベントもページが消える途中で落ちにくい）。**代わりに守るべきは投げ方のほう**:

- `track()` は `window.dataLayer` に**直接push**する。`window.gtag` を呼ぶと、gtag.js のダウンロードが終わる前に投げたイベントが落ちる — そして落ちて困るのは、まさに一番早く起きる `gallery_loading_timeout` や退場イベント。
- 退場は `visibilitychange`（hidden）と `pagehide` の**両方**を見る。`beforeunload` はモバイルSafariで発火しないので当てにしない。バックグラウンド化したタブはpagehideを出さずに殺されるので、**最初の hidden を終了とみなす**（戻ってきたら `seq` を上げて撃ち直す＝`AnalyticsProbe`）。
- **絶対に描画を止めない**。`recordVisit` の fire-and-forget（`lib/engagement.ts:19`）と同じ規律で、`track()` は throw せず、失敗は握り潰す。

### 2.4 イベント名の規約

→ **§0.3 に移動**（GA4がドットを許さないため、当初のドット記法からスネークケースへ変更）。

---

## 3. ビジターの計測ポイント（ギャラリー内・詳細版）

> 優先度: **★★★ = 最初の実装に入れる** / ★★ = 次 / ★ = あれば

### A. 到達と入場（ファネルの入口）

| # | イベント | トリガ位置 | プロパティ | 何が分かる | 優先 |
|---|---|---|---|---|---|
| A1 | `gallery.arrive` | `VisitorGallery.tsx:36` の effect 冒頭（`recordVisit` の隣） | `gallery_id` `referrer` `utm_*` `embed` `owner_preview` | 到達の生数。**現行 `visits` は sessionStorage dedupe 済みなので「到達」とは別物** | ★★★ |
| A2 | `gallery.loading.done` | `GalleryApp.tsx:250-255` の `setLoadingDone(true)` | `ms`（mount→open）`assets_total` `pct` | **入場までの体感時間**。ここが長い部屋＝作品が重い部屋 | ★★★ |
| A3 | `gallery.loading.timeout` | `GalleryApp.tsx:243` `setWaitedOut(true)` が勝ったとき | `loaded/total` | 12秒待っても素材が揃わなかった＝**未完成の部屋に入れてしまった**回数 | ★★★ |
| A4 | `gallery.abandon.loading` | ロード中に `pagehide` / hidden | `ms` `pct` | **ドアの前で帰った人**。A1−A2 の差の正体 | ★★★ |
| A5 | `gallery.webgl.unsupported` | `GalleryApp.tsx:182-189` の `setWebgl(false)`（→`:367` FlatGallery） | `ua_hint` | 3Dを一度も見ていない訪問者の数 | ★★★ |
| A6 | `gallery.context.lost` / `.restored` | `GalleryApp.tsx:277` `onLost` / `:282` `onRestored` | `auto_restored` | iOSで部屋が真っ黒になった回数。**現在まったく見えていない事故** | ★★★ |
| A7 | `gallery.perf.downgrade` | `GalleryApp.tsx:354` `PerformanceMonitor onDecline` | `from_dpr` `to_dpr` | 非力な端末の割合。品質設定の判断材料 | ★★ |
| A8 | `gallery.bgm.autoplay_unlocked` | `GalleryApp.tsx:201` `unlock()` | — | 最初の操作が起きた瞬間＝**実質的な「触った」判定** | ★★ |

### B. 部屋の中の移動

| # | イベント | トリガ位置 | プロパティ | 何が分かる | 優先 |
|---|---|---|---|---|---|
| B1 | `gallery.move.first` | `WalkControls.tsx:387` `s.dragActive = true` の初回、または `:426` の初キー入力 | `input`(drag/key/tap/joystick) `ms_since_open` | **入場から最初の一歩までの時間**。3Dの操作が分かるかどうかの唯一の実測 | ★★★ |
| B2 | `gallery.move.sample` | 1秒サンプラで `camPose`（`lib/controller.ts`）を読む | `x` `z` `yaw` | **ヒートマップの原材料**。1訪問あたり最大N件に丸めて送る | ★★ |
| B3 | `gallery.floor.tap` | `Room.tsx:182` `onFloorClick` → `WalkControls.tsx:136` `walkTo` | `dist` | タップ移動が使われているか | ★★ |
| B4 | `gallery.input.mode` | 初回のみ判定（`Hud.tsx:320` の coarse 判定と同じ） | `touch` / `mouse+key` | 端末別に操作の成否を割る軸 | ★★★ |
| B5 | `gallery.stuck` | 30秒以上 `camPose` が動かず、かつ `focusedIndex < 0` | `ms` | **迷子の検出**。`Hud.tsx:325` の「25秒アイドルでヒント再表示」ロジックと同じ勘所 | ★ |
| B6 | `gallery.tilt` | `WalkControls.tsx:358`（2本指）/ `:499`（Q/E） | — | 上下視点が使われているか（作品が高い部屋の判断） | ★ |

### C. 作品との接触 ← **今回の核心**

| # | イベント | トリガ位置 | プロパティ | 何が分かる | 優先 |
|---|---|---|---|---|---|
| C1 | `gallery.work.focus` | ストア購読 `focusedIndex` が ≥0 に変化（`store.ts:399`） | `artwork_id` `index` `via` | **作品ごとのビュー数**。今これが無い | ★★★ |
| C2 | `gallery.work.dwell` | 同 focusedIndex が変わる／-1 になる／退場したとき | `artwork_id` `ms` `hidden_ms`（除外分） | **作品ごとの滞在時間＝人気の実体**。♡ より遥かに母数が大きい | ★★★ |
| C3 | C1 の `via` の内訳 | `Exhibit.tsx:180`（作品を直接クリック）/ `WalkControls.tsx:254` `focusStep`（‹ ›・キー・スワイプ）/ `:158` `focusExhibit`（ツアー） | `via`: `click` \| `stepper` \| `tour` \| `swipe` \| `key` | **自分で見つけたのか、機械に連れて行かれたのか**。ツアー由来のビューを人気と混ぜると読み違える | ★★★ |
| C4 | `gallery.work.reach` | 各作品の初回 focus 到達 | `index` `depth`(= index+1 / 総数) | **何番目で脱落するか**。作品数の上限設計（1部屋15点）の裏付け | ★★★ |
| C5 | `gallery.work.preview3d` | `ArtworkPanel.tsx:186` `setPreview3d(true)` | `artwork_id` | 「手に取って見る」の利用率。重い機能なので費用対効果を測る | ★★ |
| C6 | `gallery.work.preview3d.dwell` | 同 `onClose`（`:247`） | `artwork_id` `ms` | 実際に回して見たのか、開いて即閉じたのか | ★★ |
| C7 | `gallery.work.buy_click` | `ArtworkPanel.tsx:197` `.panel-buy` の外部リンク | `artwork_id` `has_price` | **作家にとって最重要の1クリック**。今まったく取れていない | ★★★ |
| C8 | `gallery.work.swipe` | `ArtworkPanel.tsx:128` のスワイプ確定 / `WalkControls.tsx:376` | `dir` | スマホでの回遊手段の実態 | ★★ |
| C9 | `gallery.work.video.play` / `.progress` | `VideoArt.tsx` の `setPlaying(true)` / `lib/videohub` の近接再生 | `artwork_id` `ms` `pct` | 動画作品が**実際に再生されたか**。Video Pass($20)の価値の裏付け | ★★ |
| C10 | `gallery.work.impression` | 1秒サンプラで視錐台内かつ距離 <6m を判定（`WalkControls.tsx:236` `nearestIndex` と同じ計算が流用できる） | `artwork_id` | **前を通ったが止まらなかった**作品。C1との差が「素通り率」 | ★ |

> **C2 の実装上の注意（LESSONS 5.6 と同型）**: タブが前面に無いと3Dは描画を止める。`document.hidden` の間の経過を dwell に足すと、**タブを放置した人が「1時間その作品を見た」ことになる**。`visibilitychange` で計測を止め、`hidden_ms` を別に持つ。

### D. 音・ガイド

| # | イベント | トリガ位置 | プロパティ | 優先 |
|---|---|---|---|---|
| D1 | `gallery.tour.start` / `.end` | ストア `tourActive`（`store.ts:413`） | `works` `completed`(最後まで行ったか) `ms` | ★★★ |
| D2 | `gallery.tour.abort` | ツアー中の `WalkControls.tsx:322/428` `setTourActive(false)`（自分で歩き出した） | `at_index` | ★★ |
| D3 | `gallery.guide.play` | `ArtworkPanel.tsx:26` `audioGuide.toggle` / `:109` ツアー自動再生 | `artwork_id` `kind`(url/tts) `auto` | ★★ |
| D4 | `gallery.guide.complete` | `lib/guide.ts` の ended | `artwork_id` `pct` | ★★ |
| D5 | `gallery.tts.fallback` | `lib/guide.ts:30` `openaiTtsAvailable = false`（/api/tts が501） | — | サーバ側TTSが効いているかの監視 | ★ |
| D6 | `gallery.bgm.toggle` | `Hud.tsx:158` `toggleAudio` | `on` | **音を切った回数＝BGMがうるさい**のシグナル | ★★ |

### E. 反応と拡散

| # | イベント | トリガ位置 | プロパティ | 優先 |
|---|---|---|---|---|
| E1 | `gallery.like` | `ArtworkPanel.tsx:56` `like()` 成功時 | `artwork_id` `dwell_before_ms` | ★★★（`likes` 行はあるが、**♡までの滞在時間**は新規） |
| E2 | `gallery.share` | `Hud.tsx:165` `share()` | `method`: `web_share` \| `clipboard` | ★★★ |
| E3 | `gallery.guestbook.open` | ストア `guestbookOpen`（`store.ts:406`） | — | ★★ |
| E4 | `gallery.guestbook.submit` | `GuestbookPanel.tsx` `submit()` 成功 | `len` `has_name` | ★★（開いた数との差＝**書きかけて止めた率**） |
| E5 | `gallery.info.open` | ストア `infoOpen`（`store.ts:409`。タイトルウォール `TitleWall.tsx:123` 経由） | `via` | ★★（ステートメントが読まれているか） |
| E6 | `gallery.record.start` / `.done` | `RecordButton.tsx` `start()` / `finish()` | `ms` `size` | ★★（グロースループの実測。ほぼ出展者本人が使う） |
| E7 | `gallery.report.click` | `Hud.tsx:227` の report リンク | `gallery_id` | ★ |
| E8 | `gallery.signup_cta` | `Hud.tsx:62`（訪問者向け「無料ではじめる」）/ `:36`（埋め込みの「開く」） | `embed` | ★★★ — **ビジター→出展者への転換**の唯一の観測点 |

### F. 退場

| # | イベント | トリガ | プロパティ | 優先 |
|---|---|---|---|---|
| F1 | `gallery.exit` | `pagehide` / `visibilitychange:hidden` / `VisitorGallery.tsx:41` の cleanup | `total_ms` `works_focused` `max_depth` `did_like` `did_sign` `did_share` `reached_end` | ★★★ |
| F2 | `gallery.session.summary` | F1 と同時に1件 | 上の集計＋`route`(直リンク/explore/embed) | ★★★ — **これ1本で作家向けレポートの大半が作れる**ので、細かいイベントを削るならここを最後まで残す |

### G. ギャラリー外のビジター面

| # | イベント | トリガ位置 | 優先 |
|---|---|---|---|
| G1 | `explore.view` / `explore.load_more` / `explore.card_click` | `ExploreFeed.tsx:22` `loadMore` / `FeedCard` | ★★ |
| G2 | `artist.page.view`（`/@name`） | `app/[handle]/page.tsx` | ★★ |
| G3 | `artist.sns_click` | `components/SnsLinks.tsx` | ★ |
| G4 | `catalog.view` / `catalog.print` | `app/[handle]/[slug]/catalog/page.tsx` / `CatalogPrintButton.tsx` | ★★ |
| G5 | `embed.view` | `VisitorGallery` の `embed=true`（`app/[handle]/[slug]/page.tsx:64`） | `parent_host`(document.referrer) | ★★★ — **どのサイトに貼られているか**。埋め込みは成長ループの一部なのに今まったく見えない |
| G6 | `demo.*` | `/demo` は上記 A〜F をそのまま流用（`demoMode` フラグで分離、`store.ts:417`） | ★★★ — **デモを歩いた人がサインアップするか**が LP の主KPI |

---

## 4. 出展者（オーナー）の計測ポイント

### H. 獲得 → アクティベーション

| # | イベント | トリガ位置 | プロパティ | 優先 |
|---|---|---|---|---|
| H1 | `lp.view` / `lp.section` | `app/page.tsx`（`#concept` `#features` `#flow` `#pricing`） | `section` | ★★ |
| H2 | `lp.cta` | `app/page.tsx:74`(hero→demo) `:76`(signup) `:173`(demo) `:197`(pricing→signup) `:237`(closing) | `slot` | ★★★ — **どのCTAが効いているか**。今は完全に勘 |
| H3 | `auth.signup.start` / `.submit` / `.error` | `app/signup/page.tsx`（`lib/authErrors.ts` のキーをそのまま `reason` に） | `method`: `password` \| `google`、`reason` | ★★★ |
| H4 | `auth.signin.*` | `app/signin/page.tsx` | 同上 | ★★★ |
| H5 | `auth.cooldown_hit` | `components/auth/useCooldown.ts` | `action` | ★（再送を連打された＝メールが届いていない疑い） |
| H6 | `me.first_visit` | `app/me/page.tsx` 初回 | — | ★★★（H3との差＝**確認メールで消えた人**） |
| H7 | `me.guest_import` | `app/me/page.tsx:252` `importAll()` / `:243` `dismiss()` | `count` | ★★ |
| H8 | `me.gallery.create` | `app/me/page.tsx:327` `create()` | `template` `step_ms` | ★★★ — **アクティベーションの定義点** |
| H9 | `me.create.abandon` | `:399` step2 に進んだが `create()` に至らず離脱 | `step` | ★★ |

### I. 制作（ステージ別）— 離脱地点の特定

ステージは profile / works / room / placement / publish の5つ（`app/me/page.tsx:1161` `setStage`）。

| # | イベント | トリガ位置 | プロパティ | 優先 |
|---|---|---|---|---|
| I1 | `me.stage.view` | `app/me/page.tsx:1161` `setStage(key)` | `stage` `from` | ★★★ — **どのステージで止まるか**が最重要 |
| I2 | `me.stage.dwell` | 同上の切替時 | `stage` `ms` | ★★ |
| I3 | `me.work.upload.start`/`.done`/`.error` | `app/me/page.tsx:861` `onFiles` | `count` `bytes` `kind`(image/video) `ms` `reason` | ★★★ — **アップロード失敗は最も致命的な離脱要因**。今サイレント |
| I4 | `me.work.limit_hit` | `onFiles` の残容量クランプ（同関数内） | `cap` `attempted` | ★★★ — **課金導線の実需**がここに出る |
| I5 | `me.work.edit` | `:915` `editWork` | `field`（title/price/medium/size/…） | ★★ — どの欄が埋められ、どの欄が捨てられているか |
| I6 | `me.work.delete` | `:893` `removeWork` | — | ★ |
| I7 | `me.work.cover` | `:856` `toggleCover` | — | ★ |
| I8 | `me.room.theme` / `.layout` | `:697` `setSpace` | `key` `owned` | ★★★ — **無料枠で足りているか / 何を欲しがったか** |
| I9 | `me.room.design` | `:708` `editDesign`（wall/floor/lightColor/lightIntensity/logo/lightMode） | `field` | ★★ |
| I10 | `me.room.bgm` | `:806` `onBgmFile` / `:822` `removeBgm` | — | ★ |
| I11 | `me.placement.move` | `:736` `editPlacement`（ドラッグ&ドロップ） | `from` `to` `via`(drag/tap) | ★★ — **配置UIは3回作り直した箇所**（STATE参照）。使われているかを測るべき |
| I12 | `me.placement.remove` | 同（壁から外す） | — | ★ |
| I13 | `me.profile.save` | `:2128` `editProfile` / `:2107` `saveUsername` | `field` | ★★ |
| I14 | `me.sns.add` / `.warn` | `:2303` / `lib/sns.ts` の取り違え警告 | `platform` | ★ — 警告の発生率が高ければUIが悪い |
| I15 | `me.help.open` | `:2419` `setHelpOpen(true)` | `from_stage` | ★★ — **どのステージでヘルプが要るか**＝UIの弱点マップ |

### J. 公開 → 拡散

| # | イベント | トリガ位置 | プロパティ | 優先 |
|---|---|---|---|---|
| J1 | `me.publish.on` / `.off` | `app/me/page.tsx:685` `togglePublic` | `works` `days_since_create` | ★★★ — **最重要コンバージョン**。「作ったが公開していない」在庫が測れる |
| J2 | `me.publish.blocked` | 同関数のガード（username 未設定など） | `reason` | ★★★ |
| J3 | `me.url.copy` | `:1784` のコピーボタン | — | ★★ |
| J4 | `me.embed.open` / `.copy` | `:1698` `setShowEmbed` / モーダル内コピー | — | ★★ |
| J5 | `me.catalog.open` | 公開ステージのカタログリンク | — | ★ |
| J6 | `me.walk_own_room` | 公開ステージの「部屋を歩く」 | — | ★★（自分の部屋を見に行く＝手応えの確認行動） |
| J7 | `me.guestbook.toggle` | `:1883` `toggle()` | `enabled` | ★ |
| J8 | `me.stats.view` | `:640` `engagementSummary` の描画 | `visits` `likes` | ★★ — **作家が数字を見に来る頻度＝リテンションの先行指標** |

### K. 課金ファネル（今は成功しか見えない）

| # | イベント | トリガ位置 | プロパティ | 優先 |
|---|---|---|---|---|
| K1 | `checkout.modal.open` | `app/me/page.tsx:1230`(theme) `:1253`(layout) `:1276`(custom) `:1497`(capacity) `:1564`(video_pass) | `kind` `item_key` `from_stage` | ★★★ |
| K2 | `checkout.qty_change` | `PurchaseModal.tsx` の数量ピッカー | `qty` | ★ |
| K3 | `checkout.start` | `PurchaseModal.tsx:103` `startCheckout` 呼び出し直前 | `sku` `item_key` `qty` | ★★★ |
| K4 | `checkout.unavailable` / `.signed_out` | 同 :103 の戻り値（`lib/checkout.ts:18-27` の3値） | `kind` | ★★★ — **「買えなかった」の内訳**。過去に本番で400が出た箇所（STATE 2026-07-29） |
| K5 | `checkout.redirect` | `kind: 'redirect'` で location 遷移 | `sku` | ★★★ |
| K6 | `checkout.return` | `app/me/page.tsx:2359` `?purchase=success\|cancelled` | `result` | ★★★ — **K5 との差が Stripe 画面での離脱** |
| K7 | `purchase.recorded` | `app/api/stripe/webhook/route.ts`（サーバ側・唯一の真実） | `sku` `amount` `currency` | ★★（既に `purchases` 行があるので、イベント化は任意） |

> K3→K5→K6→K7 の4段で、**モーダルを開いた人のうち何%が払ったか**が初めて出る。今は K7 しか無い。

### L. リテンション / 解約

| # | イベント | トリガ位置 | 優先 |
|---|---|---|---|
| L1 | `me.session.start` | `/me` マウント | ★★（日次のアクティブ作家数） |
| L2 | `me.return` | 前回 `/me` からの日数 | ★★ |
| L3 | `account.email_change` / `account.marketing_toggle` | `app/me/page.tsx:1978` / `:1968` | ★ |
| L4 | `account.delete` | `:1993` `removeAccount` | ★★★ — **解約は必ず取る**（理由の任意入力を足す価値もある） |

---

## 5. 「これが知りたい」→ どのイベントの組合せで出るか

| 問い | 必要なイベント |
|---|---|
| 部屋に**入れなかった**人はどれくらいか | A1 − A2、A3、A4、A5、A6 |
| 作品ごとの人気 | C1（母数）／ C2（滞在）／ E1（♡）。**C3 の `via` でツアー由来を除外して初めて意味を持つ** |
| 何点目で飽きるか | C4 の depth 分布。1部屋15点という上限の妥当性 |
| 3Dの操作が伝わっているか | B1（最初の一歩までの時間）、B4×B1 のクロス、B5、D1（ツアーに逃げた率） |
| 作家にとっての価値（＝作品が売れる） | C7、E2、G5 |
| 「作ったのに公開しない」在庫 | H8 − J1、J2 の reason 別 |
| 有料化の実需 | I4（上限に当たった回数）、I8 の `owned:false`、K1→K6 のファネル |
| どのUIが分かりにくいか | I15（ヘルプを開いたステージ）、I2（不自然に長いステージ）、I11 |
| デモは効いているか | G6 → H3 の連結（`session` を跨いで持つ必要あり＝§6.3の判断に依存） |

---

## 6. 実装上の注意（先に踏んでおく地雷）

### 6.1 3D固有

1. **`document.hidden` を必ず見る**（AGENTS.md 5.6 と同型）。タブが後ろにあると描画は止まるが `setTimeout` は動く。滞在時間に hidden 中の経過を足すと数字が全部嘘になる。
2. **`useFrame` の中で track を呼ばない**。1秒サンプラで `camPose` を読む（§2.2）。
3. **ロード中の離脱を測るには、計測コードがロード完了前に動いている必要がある**。`AnalyticsProbe` を `GalleryApp` の中に置くと、A4（ドアの前で帰った人）が取れない。**`VisitorGallery` 側**（`dynamic()` の外）に置くこと。
4. `visits` テーブルの dedupe 仕様（1タブ1件）は**変えない**。`visitCount` は3Dの past-visitor ゴースト数を決めている（`lib/ghosts.ts:12` `ghostCountForVisits`）ので、母数を変えると**見た目が変わる**。新しい粒度は新テーブルへ。

### 6.2 サーバ/DB（案Aの場合）

- `supabase/migrations/0036_events.sql` を足す。RLS は `visits`（schema.sql:312-327）と同じ型 — **anon insert は「公開中のギャラリーに対してのみ」、SELECT はオーナーのみ**。
- **AGENTS.md 5.8 の番人**: migration を足したら `supabase/schema.sql` の節と `supabase/README.md` §1 の箇条書きにも足す。`npm run check:schema` が落ちる。
- スキーマ案: `id / gallery_id (nullable) / name text / props jsonb / created_at`。作家ダッシュボード用の集計は後からマテビューでよい。
- **anon insert を開けるテーブルは荒らせる**。既存 `visits` も同じ露出だが、`events` は props が自由なぶん被害が大きい。`props` にサイズ上限、`name` に許可リストの check 制約を入れる。

### 6.3 プライバシー（GA4採用後の状態）

- **プライバシーポリシーは改訂済み**（`app/privacy/page.tsx`）。§1に計測内容と「氏名・メール・アカウントIDをGoogleに渡さない／広告に使わない」、§3の処理者一覧にGoogle Analytics、§8にCookieの扱い。**規約・プライバシーは英語版が正**（`scripts/check-i18n.mjs` の `ALLOW`）なので、11言語の作業は発生しない。
- **EEA/UK/CH は `analytics_storage: denied` の既定**。Cookieを置かないので、そこは同意なしで運用できる形になっている。ただし**バナーを出すまで当該地域の数値はGoogleの推計**であり、全数ではない。
- コード側で止められないものが1つある: **GA4管理画面の Googleシグナル／広告向けデータ共有**。ここをオンにすると privacy に書いた内容と食い違う。オフのままにすること。

### 6.4 番人（AGENTS.md 5.x）

- 計測イベントは**画面に出る文言を持たない**ので `check:i18n` の対象外。ただし「同意バナー」やダッシュボードの新しいグラフの見出しを足すなら **en/ja 両方＋11言語**が必須（5.1）。
- `check:css` は「CSSがあってマークアップが無い」片方向しか見ない（5.2）。ダッシュボードにグラフを足すときは注意。
- push 前に `npm run check:ship-ready`（5.7）。並行セッションが動いている。

---

## 7. 最小構成で始めるなら（第1弾の推奨セット）

計測は入れれば入れるだけ設計と検証のコストが増える。**14イベントに絞れば、上の問いの8割が答えられる**:

**ビジター**: A2 / A4 / A5+A6（入場の成否）、B1（最初の一歩）、C1 / C2 / C3（作品ビュー・滞在・経路）、C7（購入クリック）、E2（共有）、E8（サインアップCTA）、F2（セッション要約）
**出展者**: I1（ステージ遷移）、I3（アップロード）、J1（公開）、K1→K6（課金ファネル）

F2（セッション要約）は他が全部落ちても単体で意味を持つので、**最初の1本にするならこれ**。


---

## 8. 実装済みイベント一覧（2026-08-06 時点）

`lib/analytics.ts` の `track()` を経由するもの。名前はコード上の正（スネークケース）。

**ビジター（ギャラリー内）** — `components/gallery/AnalyticsProbe.tsx` がストア購読で出すものが中心
`gallery_arrive` / `gallery_loading_done` / `gallery_loading_timeout` / `gallery_webgl_unsupported` / `gallery_context_lost` / `gallery_context_restored` / `gallery_perf_downgrade` / `gallery_move_first` / `gallery_move_sample` / `gallery_stuck` / `gallery_work_focus` / `gallery_work_dwell` / `gallery_work_preview3d` / `gallery_work_preview3d_close` / `gallery_work_buy_click` / `gallery_like` / `gallery_share` / `gallery_tour_start` / `gallery_tour_end` / `gallery_guestbook_open` / `gallery_guestbook_submit` / `gallery_info_open` / `gallery_bgm_toggle` / `gallery_report_click` / `gallery_signup_cta` / `gallery_session_summary` / `embed_open_full`

**出展者**
`me_stage_view` / `me_work_upload_start` / `me_work_upload_done` / `me_work_upload_error` / `me_work_limit_hit` / `me_publish_on` / `me_publish_off` / `me_publish_blocked` / `checkout_modal_open` / `checkout_start` / `checkout_redirect` / `checkout_return` / `checkout_blocked` / `checkout_error`

### 検証で確かめたこと（2026-08-06）

- `track()` の GA4ガード: 不正名（ドット入り）を弾いてconsoleに出す／null・undefinedを落とす／値を100文字で切る／パラメータを25個で打ち切る。
- 未設定時（`NEXT_PUBLIC_GA_ID` 空）は **`window.dataLayer` すら作らない**＝完全に無音。
- 実ブラウザで Consent Mode v2 の並び順を実測: `consent default(EEA=denied, region配列あり)` → `consent default(granted)` → `js` → `config(send_page_view:false)` の順に積まれ、gtag.js のリクエストは1回。広告系は全地域 denied。
- `page_view` は**1ページにつき1件**（`send_page_view:false` と手動送信の二重計上が無いこと）。
- 合成データの一時ページ（検証後に削除）で `AnalyticsProbe` を実駆動: `via` が click / stepper / tour を正しく撃ち分け（**ツアー中の focus はツアーが勝つ**）、dwell は 1500ms 待ちに対し 1505ms、`gallery_session_summary` が `works_focused:3` `max_depth:3` `reached_end:true` `did_like:true` で1件。
- **hidden時間の除外**を実測: 1秒視聴 → 3秒バックグラウンド → 1秒視聴 で、dwell は 1006ms と 1003ms の2件（計 約2秒）。素朴な実装なら約5000msと報告していた。
- `/demo` の実ブラウザ走行で `gallery_loading_timeout`（`loaded:8 total:21`）と `gallery_loading_done` が実際に発火することを確認（ヘッドレスはソフトウェアレンダリングのため遅い）。

### 残（ユーザー作業）

1. **GA4プロパティを作り `NEXT_PUBLIC_GA_ID` を Vercel の環境変数に設定**（未設定の間は何も起きない）。
2. GA4管理 → **Googleシグナルと広告向けデータ共有をオフのままにする**（privacy に「広告に使わない」と書いたため）。
3. 管理 → カスタム定義で、使うパラメータを**イベントスコープのカスタムディメンションとして登録**（`artwork_id` `via` `stage` `surface` `kind` `reason` `result` あたり）。登録しないと標準レポートに出ない。
4. 作品別ランキングを本気でやるなら **BigQueryエクスポートを有効化**（GA4のUIは高カーディナリティを丸める）。
5. **同意バナーを出すか決める**。出さない限りEEA/UK/CHはクッキーレスの推計のまま。出すなら11言語のUI文言が要る（AGENTS 5.1）。


---

## 9. GA4 管理画面のセットアップ手順（依頼用・コード側は完了済み）

コードの計測は入っており、**`NEXT_PUBLIC_GA_ID` が入るまで何も送信しない**状態で待っている。以下はすべてGA4/Vercelの管理画面作業で、リポジトリを触る必要はない。

### 9.1 必須（この順で）

1. **GA4プロパティ＋ウェブデータストリームを作る** — 対象は `https://www.xibit360.art`。取得する `G-XXXXXXXXXX` が成果物。
2. **Vercel に環境変数 `NEXT_PUBLIC_GA_ID` を設定** — 値は `G-XXXXXXXXXX`。**Production のみ**（Preview/Development は未設定のままにする＝プレビュー配信がプロパティを汚さない）。
3. **再デプロイする** — `NEXT_PUBLIC_*` は**ビルド時にJSへ焼き込まれる**。環境変数を足しただけでは既存の配信は変わらない。ここを飛ばすと「設定したのに何も来ない」になる。
4. **データ保持を14か月に** — 管理→データ設定→データ保持。**既定は2か月**で、過ぎた分は探索レポートから消える。
5. **Googleシグナル OFF・広告向けデータ共有 OFF** — 管理→データの収集と修正→データ収集。**プライバシーポリシーに「広告に使わない／広告機能とデータ共有はオフ」と明記して公開済み**なので、ここをオンにすると公開文書と食い違う。
6. **User-ID機能は設定しない** — 同じくポリシーで「アカウントIDをGoogleに渡さない」と書いている。

### 9.2 レポートを使えるようにする

7. **カスタムディメンションを登録**（管理→カスタム定義→イベントスコープ。上限50）。**登録しないと標準レポートに列として出ない**（BigQueryには入る）。優先順:

   | 範囲 | パラメータ |
   |---|---|
   | 最優先 | `artwork_id` `via` `surface` `stage` `kind` `reason` `result` `room_opened` |
   | 次点 | `from_stage` `method` `referrer` `embed` `first_time` `reached_end` `timed_out` `has_price` |
   | 余裕があれば | `gallery_id` `item_key` `theme` `layout` `did_like` `did_share` `did_sign` `on` `recording` `has_name` `from` |

   数値パラメータ（`ms` `total_ms` `hidden_ms` `depth` `max_depth` `works_focused` `count` `bytes` `cap` `qty` `loaded` `total` `seq` `index` `at_index` `x` `z` `yaw` ほか）は**カスタム指標**として登録すると平均・合計が出せる。まずは `ms` `total_ms` `depth` `max_depth` `works_focused` だけで足りる。

8. **キーイベント（旧・コンバージョン）に指定** — `me_publish_on`（部屋の公開＝最重要）／`gallery_work_buy_click`（作品の購入リンク）／`checkout_return`（課金の完了/離脱）／`gallery_signup_cta`（訪問者→作家）。
9. **内部トラフィックの除外** — 管理→データストリーム→タグ設定→内部トラフィックの定義に自分のIPを入れ、データフィルタを「有効」に。自分の閲覧で数字が膨らむのを防ぐ。
10. **（任意・推奨）BigQueryエクスポートを有効化** — `artwork_id` のような値の多いディメンションはGA4標準レポートで `(other)` に丸められる。作品別ランキングを本気でやるなら要る。無料枠で足りる。

### 9.3 動作確認（DebugView / リアルタイム）

再デプロイ後、本番の公開ギャラリーを開いて以下が出るか見る:

- 入場時 … `gallery_arrive` → `gallery_loading_done`
- 歩く … `gallery_move_first`、しばらくして `gallery_move_sample`
- 作品をクリック … `gallery_work_focus`（`via=click`）→ 離れると `gallery_work_dwell`
- ‹ › で送る … `gallery_work_focus`（`via=stepper`）
- タブを閉じる … `gallery_session_summary` が**1件**

> **⚠️ ここだけ要確認**: `page_view` が**1ページにつき1件**か。コード側は `send_page_view:false` にして自前で1回だけ送っているが、GA4の**拡張計測機能「ブラウザの履歴イベントに基づくページ変更」**が同時に発火すると二重計上になり得る。ローカル検証では gtag.js をブロックして計測したため、**この組み合わせだけ未検証**。DebugViewで `page_view` が2件出るようなら、管理→データストリーム→拡張計測機能→ページビューの詳細設定で当該オプションをオフにする。

### 9.4 判断が要る（作業ではなく決定）

- **同意バナーを出すか。** 現状 EEA/UK/CH は Consent Mode v2 で `analytics_storage: denied` 既定＝Cookieを置かないクッキーレス計測（Googleの推計が混じる）。バナーを出せば実数になるが、**11言語のUI文言**が必要（AGENTS 5.1）。コード側の呼び口 `grantAnalyticsConsent()` は用意済み。
