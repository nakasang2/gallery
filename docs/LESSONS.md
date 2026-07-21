# LESSONS.md — 失敗・成功パターン台帳

> Claude向け運用ルール: ビルド/デプロイの失敗、ユーザーからの修正指摘、同じ質問の繰り返しが起きたら**対応した直後に**1エントリ追記する。同種の作業を始める前に該当カテゴリを読む。同種パターンの発生回数（×N）が3回に達したら、DECISIONS.md の絶対ルール化またはスキル化を /kaizen で提案する。

フォーマット: `日付 | 事象 → 原因 → 回避策`（1〜3行。再発したら新規追加せず既存エントリの ×N を加算）

## 失敗パターン

### ビルド・デプロイ
- 2026-07-21 | 別セッション成果をpullしたら `git-lfs: command not found` で途中中断し、作業ツリーが中途半端に更新（HEADは旧のまま／tracked=modified・新規=untrackedが大量に発生） → このリポジトリはLFS管理（`visitor`系glb等）なのに実行環境へgit-lfs未導入 → **セッション開始時にpullが「Filtering content」やlfs関連で失敗したら、まず `brew install git-lfs`+`git lfs install`。中途破損した作業ツリーは、開始時クリーンなら `git reset --hard origin/main` で一括復旧できる（HEADは未移動＝コミット履歴は無傷）。破壊的コマンドがauto-mode classifierにブロックされたらユーザー承認を取ってから実行する**

### 品質・レビュー
- 2026-07-13 | デモ→戻るで環境音が鳴り止まない（ユーザー報告）→ `galleryAudio`がモジュールsingletonで`AudioContext`を停止する手段が無く、`GalleryApp`アンマウント時に何も止めていなかった → **没入体験が使うsingletonの外部リソース（AudioContext等）は体験コンポーネントのアンマウントで明示的にsuspend/停止する。`ctx.suspend()`は非同期で反映に約1秒かかるため、master gainを即0にして即時ミュートを併用する**（`lib/audio.ts`/`lib/videohub.ts`/`GalleryApp`。Playwright+同梱Chromiumで離脱後にsuspendされることを実挙動検証）
- 2026-07-13 | 「サインイン中はデモ作品を混ぜない」を`rowSpace`で`showDemo:false`にしたら、その値が`localStorage`へ永続化され、サインアウト後のゲスト体験でデモが空になる副作用 → 永続設定(`Settings.showDemo`)にサインイン依存の値を書き込むと状態が漏れる → **サインイン状態に依存する表示分岐は永続設定に書かず派生状態（フック`useIsOwnerEditing`）で計算する**
- 2026-07-13 | 対外文言（ランディング料金表）が実装・要件のピボット後もそのまま残り、¥980/月サブスク×無制限という古いモデルを提示していた → LPを実装/要件と別管理で更新し忘れ → **料金・数値の文言はプラン変数(`lib/limits.ts`)・価格定数(`lib/pricing.ts`)から参照し、直書きしない**（kaizen 2026-07-21: 07-21のブランド名直書き150箇所と合わせ「外向き文言の直書き」×2。自然文の言及は中央化不可でルール化の実益が限定的なため、絶対ルール化は**見送り**。次に固有名詞/料金の変更が来て×3になったら再検討）
- 2026-07-21 | LPフッターに固定3D背景（HeroCanvas）が透けて雑然と見える（ユーザー報告）→ 3Dヒーローがページ全体の背後に常駐する構成なのに `.footer` に background 指定がなく透明で、フィックスされた3Dシーン（額縁/床）がフッターを透過していた（`::before` の継ぎ目グラデは `var(--bg)` へ向かうのに本体が透明） → **固定3D/canvasが背後に常駐するページでは、前面の各セクション・フッターに不透明背景（`var(--bg)`）を必ず与える。透明だと3Dが透ける。追加後は `getComputedStyle(el).backgroundColor` で不透明を確認できる**（`app/landing.css` の `.footer`）
- 2026-07-21 | 埋め込み機能: ダッシュボードのEmbedボタンが生成する `/@name?embed=1` が埋め込みモードにならず、iframe内でもフルHUD（Start free CTA等）が出ていた → 同じ機能に2つのルート形（`/@name` ハンドル直下 と `/@name/[slug]` 個別展示）があり、embed対応が slug 側にしか入っておらず、生成URLが指す**ハンドル直下側が `searchParams` を未処理** → **自分でURL/ディープリンクを生成する機能では、受け側ルートがそのクエリ/パラメータを実際に処理するか必ず確認する。同一機能が複数ルート形を持つときは全ルートで同じparam対応を揃える。UI確認はプレビューでHUDの差（省略/バックリンク化）まで見る**（`app/[handle]/page.tsx` と `app/[handle]/[slug]/page.tsx`）
- 2026-07-21 | ⓘツールチップ実装（§11.29）で入力欄がアクセシブルネームを失う回帰（マージ前レビューで検出） → `<label>`内で入力欄より前に `<button>`（=labelable要素）を置くと、labelが「最初のlabelableな子孫」＝ボタンに関連付き、入力欄からラベルが外れる（ラベルクリックもボタンにフォーカス） → **`<label>`でラップするフォームでは、ラベル装飾に置く操作要素（ⓘ/ヘルプ等）に labelable 要素（button/input/select/textarea/meter/output/progress）を使わない。tooltipトリガーは `<span tabIndex={0}>`（labelableでないのでlabelは入力欄に付く。CSS `:focus`/`:focus-within` でキーボード表示も維持）。疑わしければ `label.control` が入力欄を指すか実DOMで確認する**（`app/me/page.tsx` の `FieldLabel`）
- 2026-07-17 | ダッシュボード設定画面のUX改善で、密度/スクロールの表層問題だけ見て「Room/This-workスコープ切替」を実装 → ユーザー「50点・微妙」。真因は**情報設計の粒度**（「Roomの中に作品がある」のに作品カルーセルが親Roomより上にあり入れ子が破綻。トグルは別の抽象を足しただけ）→ **UIを直す前に「概念の包含関係(親⊃子: Room⊃作品)」を先に確定し、DOM/視覚の並び順をそれに一致させる。表層の症状(スクロールが長い/密度が高い)に対症療法(トグルで隠す等)を足すと粒度がずれて逆に悪化する。採用形は we-right を The room→Design Tools→Works in this room(カルーセル)→選択作品 の親⊃子一本フロー**（`app/me/page.tsx`）

### 3Dアセット
- 2026-07-16 | 「使えるモデルを追加した」と渡された`walk.glb`/`idle.glb`が各約200MB(Web要件に3桁オーバー) → Blenderエクスポート時にKitBash3D「NeoCity」街並みキット(99%)が誤同梱され、実キャラは約2MBだった → **取得した3Dアセットは使う前に必ず中身を検分する(`gltf-transform inspect`/glbのJSONチャンク解析でメッシュ名・skin有無・テクスチャ解像度・シーン構成を見る)。巨大化の一次対処は「圧縮」ではなく「不要コンテンツの除去」。skin付き(=キャラ)とstatic(=環境)を分けて実サイズを測ると原因が即分かる。仕上げに `gltf-transform` で街シーン破棄→テクスチャWebP縮小→Draco圧縮で200MB→1.6MB**
- 2026-07-16 | glTFキャラを多数インスタンス化したら全員T字ポーズで固まりアニメが効かない → skinメッシュを`scene.clone()`するとスケルトン(ボーン)参照が切れ、mixerが駆動できずバインドポーズのまま → **skinメッシュの複製は必ず`three/examples/jsm/utils/SkeletonUtils.js`の`clone()`を使う。`useGLTF`はurl単位でキャッシュされるので、共有シーンを各インスタンスで`SkeletonUtils.clone`し、`useAnimations(clips, instanceRef)`で個別mixerを張る**
- 2026-07-16 | Draco圧縮glbを`useGLTF`で読むとデコーダをCDN(gstatic)に取りに行く → 自己完結アプリ/オフライン/CSPで壊れる恐れ → **`three/examples/jsm/libs/draco/gltf/`のデコーダを`public/draco/`へvendorし、`useGLTF.setDecoderPath('/draco/')`+`useGLTF(url,'/draco/')`でローカル解決する**
- 2026-07-21 | KitBash混入で巨大化した旧 `idle/walk/idle2/walk2.glb`（計528MB）が、軽量 `visitor.glb`/`visitor2.glb` へ一本化した後もmainに数日残置 → 差し替え時に旧アセットの `git rm` を忘れ、LFS帯域とclone/pull時間を浪費（今回のpull中断の遠因） → **アセットを差し替えたら旧ファイルは同じPRで `git rm` する。掃除前に `grep -rn '/models/' lib components app` で参照を突き合わせ、孤児glb/LFSがないか確認する**

## 成功パターン（スキル化候補の芽）
- 2026-07-13 | 3D没入を壊すネイティブ`alert()`を、疎結合の極小toast(`lib/toast.ts` = モジュールレベルのlistener集合 + `useToast`フック)へ置換。store等の非Reactコードからも`showToast()`で呼べる。破壊的`confirm()`だけは意図的にネイティブ据え置き
- 2026-07-21 | スクロール同期3DのLPは下部(フッター等)まで実スクロールで到達しようとすると重くてプレビュー操作がタイムアウトする。検証時は `javascript_tool` で `.corridor` の height を潰し・上位セクションを `display:none` にして対象を最上部へ引き上げ、`scrollIntoView`+スクショ／`getComputedStyle(el)` で確認すると速い（本番URLでも同じ手が使える。ページ本体は変更しないデバッグ操作）
- 2026-07-21 | 大規模リネーム(HAKONIWA→Xibit360 約150箇所)は二段構えが安全: ①決定的で誤爆しない置換(ドメイン・保存キー・識別子・package名)を先に `perl`/スクリプトで一括、②文脈判断が要る分(ロゴ/文中の大小・普通名詞化・日本語の語)は詳細ルールを書いてサブエージェントに委譲。最後に「旧語の残存0・誤TLD 0・二重置換0」をgrep検証＋tsc/build＋実画面。macOSのbashは3.2で `mapfile` 不可・`grep -Z|xargs -0` がパスの`[handle]`等で崩れることがあるので `while IFS= read -r` が堅い
