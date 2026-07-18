# LESSONS.md — 失敗・成功パターン台帳

> Claude向け運用ルール: ビルド/デプロイの失敗、ユーザーからの修正指摘、同じ質問の繰り返しが起きたら**対応した直後に**1エントリ追記する。同種の作業を始める前に該当カテゴリを読む。同種パターンの発生回数（×N）が3回に達したら、DECISIONS.md の絶対ルール化またはスキル化を /kaizen で提案する。

フォーマット: `日付 | 事象 → 原因 → 回避策`（1〜3行。再発したら新規追加せず既存エントリの ×N を加算）

## 失敗パターン

### ビルド・デプロイ
- （まだなし — 最初の失敗が起きたときにここへ追記する）

### 品質・レビュー
- 2026-07-13 | デモ→戻るで環境音が鳴り止まない（ユーザー報告）→ `galleryAudio`がモジュールsingletonで`AudioContext`を停止する手段が無く、`GalleryApp`アンマウント時に何も止めていなかった → **没入体験が使うsingletonの外部リソース（AudioContext等）は体験コンポーネントのアンマウントで明示的にsuspend/停止する。`ctx.suspend()`は非同期で反映に約1秒かかるため、master gainを即0にして即時ミュートを併用する**（`lib/audio.ts`/`lib/videohub.ts`/`GalleryApp`。Playwright+同梱Chromiumで離脱後にsuspendされることを実挙動検証）
- 2026-07-13 | 「サインイン中はデモ作品を混ぜない」を`rowSpace`で`showDemo:false`にしたら、その値が`localStorage`へ永続化され、サインアウト後のゲスト体験でデモが空になる副作用 → 永続設定(`Settings.showDemo`)にサインイン依存の値を書き込むと状態が漏れる → **サインイン状態に依存する表示分岐は永続設定に書かず派生状態（フック`useIsOwnerEditing`）で計算する**
- 2026-07-13 | 対外文言（ランディング料金表）が実装・要件のピボット後もそのまま残り、¥980/月サブスク×無制限という古いモデルを提示していた → LPを実装/要件と別管理で更新し忘れ → **料金・数値の文言はプラン変数(`lib/limits.ts`)・価格定数(`lib/pricing.ts`)から参照し、直書きしない**
- 2026-07-17 | ダッシュボード設定画面のUX改善で、密度/スクロールの表層問題だけ見て「Room/This-workスコープ切替」を実装 → ユーザー「50点・微妙」。真因は**情報設計の粒度**（「Roomの中に作品がある」のに作品カルーセルが親Roomより上にあり入れ子が破綻。トグルは別の抽象を足しただけ）→ **UIを直す前に「概念の包含関係(親⊃子: Room⊃作品)」を先に確定し、DOM/視覚の並び順をそれに一致させる。表層の症状(スクロールが長い/密度が高い)に対症療法(トグルで隠す等)を足すと粒度がずれて逆に悪化する。採用形は we-right を The room→Design Tools→Works in this room(カルーセル)→選択作品 の親⊃子一本フロー**（`app/me/page.tsx`）

### 3Dアセット
- 2026-07-16 | 「使えるモデルを追加した」と渡された`walk.glb`/`idle.glb`が各約200MB(Web要件に3桁オーバー) → Blenderエクスポート時にKitBash3D「NeoCity」街並みキット(99%)が誤同梱され、実キャラは約2MBだった → **取得した3Dアセットは使う前に必ず中身を検分する(`gltf-transform inspect`/glbのJSONチャンク解析でメッシュ名・skin有無・テクスチャ解像度・シーン構成を見る)。巨大化の一次対処は「圧縮」ではなく「不要コンテンツの除去」。skin付き(=キャラ)とstatic(=環境)を分けて実サイズを測ると原因が即分かる。仕上げに `gltf-transform` で街シーン破棄→テクスチャWebP縮小→Draco圧縮で200MB→1.6MB**
- 2026-07-16 | glTFキャラを多数インスタンス化したら全員T字ポーズで固まりアニメが効かない → skinメッシュを`scene.clone()`するとスケルトン(ボーン)参照が切れ、mixerが駆動できずバインドポーズのまま → **skinメッシュの複製は必ず`three/examples/jsm/utils/SkeletonUtils.js`の`clone()`を使う。`useGLTF`はurl単位でキャッシュされるので、共有シーンを各インスタンスで`SkeletonUtils.clone`し、`useAnimations(clips, instanceRef)`で個別mixerを張る**
- 2026-07-16 | Draco圧縮glbを`useGLTF`で読むとデコーダをCDN(gstatic)に取りに行く → 自己完結アプリ/オフライン/CSPで壊れる恐れ → **`three/examples/jsm/libs/draco/gltf/`のデコーダを`public/draco/`へvendorし、`useGLTF.setDecoderPath('/draco/')`+`useGLTF(url,'/draco/')`でローカル解決する**

## 成功パターン（スキル化候補の芽）
- 2026-07-13 | 3D没入を壊すネイティブ`alert()`を、疎結合の極小toast(`lib/toast.ts` = モジュールレベルのlistener集合 + `useToast`フック)へ置換。store等の非Reactコードからも`showToast()`で呼べる。破壊的`confirm()`だけは意図的にネイティブ据え置き
