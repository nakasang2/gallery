# DECISIONS

## 現在の前提・絶対ルール
- **サービス名は Xibit360**（旧 HAKONIWA）。表記: ロゴ/マーク=`XIBIT360`（全大文字）、文中/メタデータ/OG=`Xibit360`（Title case）。ユーザーの1ギャラリーを指す普通名詞は英語UIで `gallery`/`galleries`、日本語docで「ギャラリー」。
- **本番の公開URLは https://xibit360.art**（ムームードメイン取得・Vercel Production）。ship時の反映確認はこのドメインをポーリングする。Vercelの自動生成URL（`*-projects.vercel.app` 等）はDeployment Protectionでログイン必須になり得るので共有・埋め込みには使わない。

## 並行セッションの担当
- （並行して動く別セッションの担当領域をここに記録する）

---

## 2026-07-23 参考写真クオリティへの引き上げ（コンクリ壁・物理減衰・器具・2層影）
- 背景: 3ティア化後もユーザー評価「まだ40点。参考写真（暗いコンクリ壁＋ウォームスポット＋精巧な影）くらいを出したい。フレームやライトのディテール、影の精巧さ」。
- 決定1（壁素材）: `ThemeDef.wallFinish: 'plaster'|'concrete'` を追加し、**chic/noirを打ち放しコンクリート**に（whitecubeは漆喰のまま）。`getConcreteMaps()`（`textures.ts`）で手続き生成: 1024pxタイル=3.2m×3.2m、型枠目地1.6mグリッド・セパ穴（目地から0.35mオフセット）・骨材ピット2400個・水染み・セメントむら。color/normal/roughnessの3マップが同一ジオメトリで整合（穴の凹みと黒ずみが一致）。colorはニュートラル明灰で`theme.wall`が乗算tint→テーマ色は今後も効く。
- 決定2（光の減衰）: スポットを`decay 1.1→2`（物理的な逆二乗減衰）。露出は取り付け距離ごとの係数で再平衡（ceilingトラック=×2.6 / picture light=×0.62 / ベンチ=26）。光だまりが「中心が明るく周辺へストンと落ちる」実ギャラリーの見え方に。
- 決定3（器具ディテール）: 天井トラックスポットを単一円筒→**キャノピー＋ステム＋フレアバレル＋トリムリング＋発光開口**の組立体に。発光ディスク(emissive・toneMapped無効)が「この器具が光源」だと分かる要。
- 決定4（影の2層化）: 壁の疑似落ち影を「外周ソフト(opacity0.4)＋フレーム際タイト(0.36)」の2枚重ねに（コンタクトハードニング近似: 際は濃く締まり、離れるほど柔らかい）。
- 検証: tsc・buildクリーン。/demo実機で chic(明・コンクリ)＋noir(暗・参考写真ムード)両方、picture light/ceilingトラック両モード、目地・セパ穴・光錐・床反射を確認。コンソールエラーなし。
- メモ: 参考写真の完全な暗さは**noirテーマ**が該当（chicは明るめ基調のまま素材だけ高級化）。

## 2026-07-23 描画品質を3ティア化＋質感ブラッシュアップ（高級感／低スペック配慮）
- 背景: ユーザー「3Dの見え方が安っぽい。光/影/テクスチャ/モデル精度を多角的にブラッシュアップしたい。ただし低スペック端末では影や反射を無くす等の工夫も」。
- 決定1（品質ティア）: 従来の2値`LOW_POWER`(タッチ判定のみ)を**3ティア`QUALITY`**へ拡張（`lib/controller.ts`）。high=PC(フルパイプライン)／medium=通常スマホ(実影1024・clearcoat床・ポストエフェクトなし)／low=低スペックスマホ(`deviceMemory<=4GB`または`hardwareConcurrency<=4`)。**lowは実影・反射を完全オフ**(`shadowMap.enabled=false`・DPR上限1.25)、奥行きは既存のアートディレクション疑似影で担保（ベンチにも疑似接地影プレーンを追加）。`LOW_POWER`は互換維持（`QUALITY!=='high'`、従来のタッチ判定と同値）。
- 決定2（PCの解像度）: DPR上限を1.75→**2**に引き上げ、drei `PerformanceMonitor`でFPS持続低下時に**2→1.5→1.25へ自動降格**（ロード画面終了後に監視開始・タブ非表示中は降格しない・復帰昇格なし）。
- 決定3（質感）: ①作品表面に**キャンバス織り目**の手続きバンプ（`getCanvasWeave`、実寸で糸ピッチ約2mm一定、bumpScale0.35。動画作品は除外）→「壁に貼ったスクショ」感の解消。②天井に漆喰ノーマルマップ（strip光のグレージングで質感）。③額縁ベベル3→5セグメント（ハイライトが滑らかに回る）。④床/作品テクスチャの異方性フィルタ8→16（浅い角度での木目/絵のニジミ解消）。
- 検証: tsc・buildクリーン。/demo(PC)で織り目(0.55はスキャンライン状に強すぎ→0.35に調整)・額装/額なし両方の描画・反射/ゴースト/疑似影・コンソールエラーなしを実機確認。low/mediumティアはプレビューでポインタエミュ不可のため**実スマホでの本番QAが残**。

## 2026-07-23 3Dギャラリーの陰影realism強化（PC向け・自然/上品）
- 背景: ユーザー「影がない／3Dのリアリティがない」。現状は作品スポットが額縁影を壁に焼き込み＋N8AO接地は入っていたが、影が`PCFShadowMap`(硬い)でCGっぽかった。対象はPC（スマホはLOW_POWERでEffects一式オフ＝別問題、今回は対象外）。
- 決定（自然/上品な範囲で）: ①`gl.shadowMap.type` を `PCFShadowMap`→`PCFSoftShadowMap`。②`SpotWithTarget` に `shadow-radius`(既定4)を追加しソフトな半影に（作品スポット＋ベンチのダウンライト＝床の接触影も自動でソフト化）。baked（autoUpdate=false）でもtypeとradiusは描画時サンプリングに効くので有効。③`N8AO` を `aoRadius 1.2→1.5 / intensity 2.4→2.6` で接地感を少し強く。
- 検証: tsc・buildクリーン。/demo（PC）で白/ネイビー額縁の柔らかい落ち影＋隅のAO接地陰を実機確認、コンソールエラーなし。強さは`shadow-radius`/N8AO値で微調整可。
- 残（今回対象外）: スマホは`LOW_POWER`でAO等オフのため平面的なまま。必要なら軽量な接地陰の別途検討。
- **追記 2026-07-23（追い込み）**: ①`shadow-radius 4`はソフトすぎて影が見えづらいFB→**2**へ（くっきり寄り）＋作品スポット`shadowMapSize`を`1024→2048`(PC)で輪郭を明瞭化。ベンチ・額装とも共有で改善。②`PCFSoftShadowMap`は「一番外の枠」だけcastだと中抜けになる件はmat/art面castShadowで対応済（LESSON 2026-07-23）。③**反射床**: 床を`meshPhysicalMaterial`→**drei `MeshReflectorMaterial`**(PCのみ・`LOW_POWER`は従来のclearcoat維持)。作品/ゴースト/室内が床に映り込みリアリティUP。設定=resolution512/blur[320,90]/mixStrength0.55/mirror0.4/roughness0.82で「鏡でなく艶のある木床」。木目はmap/roughnessMap/bumpMapで維持、`receiveShadow`維持でベンチ影も床に出る。/demoで反射・影・エラーなしを実機確認。
- **追記2 2026-07-23（額縁の壁影を参考写真並みに）**: 実シャドウマップは近接マウント＋角度で淡く、参考写真のような明確な落ち影が安定して出せない（3回調整しても弱い）→ **アートディレクションされたソフト影プレーンを併用**（`getSoftShadowTexture`＝ブラー済み暗い角丸／`Exhibit`で作品背後 z0.006・少し下(-0.06)・やや大きめ・opacity0.42）。ライトモード非依存で確実、スマホでも出る。反射は「床より上の全要素」が対象（平面反射なので天井ライト/ベンチ/作品/ゴースト全部映る）＝ユーザー確認質問への回答。実影(bench/floor)は継続。opacity/offset/sizeで調整可。LESSON 2026-07-23参照。

## 2026-07-23 /demoを額縁の「見本市」化＋来場者編集UIをデモで非表示
- 背景: デモで額縁を変えられる方が良いか？の議論。結論=デモは来場者に編集させるより、**多様な見た目を並べた見本市**として見せる方が価値が高い（歩くだけで額縁/マット/掛け方の幅が伝わる）。編集の自由度はサインイン後の自分のギャラリーで提供。
- 決定1: デモ10作品(`ARTWORKS` a01〜a10)に**多様な額縁を割り当て**（`lib/artworks.ts` の `DEMO_DESIGN`＋`demoDesignOverrides()`）。gold/oak/white/black/none＋custom(navy paint/walnut/silver metal/wine/極太ink)、マット・掛け方・キャプションも変化。`GalleryApp`のdemo時に`useGallery.setState(...)`で流し込む=**永続化しない**(updateSettingsでなくsetState。ゲストのlocalStorageを汚さない。LESSON 2026-07-13の永続設定汚染回避)。適用は`loadingDone && !user && !visitor`後(hydrateにclobberされない)。
- 決定2: 作品詳細パネル下部の**per-work編集UI(WorkDesign)をデモで非表示**。条件を`!visitor`→`!visitor && !demoMode`に(オーナー編集時のみ表示、公開閲覧とデモでは非表示)。デモは純粋な見本市に。
- 見送り: B案(管理のDemo設定画面)は当面見送り。デモ内容は頻繁に変えないためまずコード見本市で効果を見る→頻繁に変えたくなったら`/admin`に設定画面を追加(既存`DemoLookEditor`/`site_config`拡張)。
- 検証: tsc・buildクリーン。/demoで`frameOverrides`等がa01〜a10に適用・編集UI非表示・a01=gold/a04=額縁なしの描画差を実機確認。

## 2026-07-22 読み上げに館内リバーブ＋/demoにゴースト来場者
- 決定1（リバーブ）: OpenAI音声の読み上げを既存の「ホール残響」ConvolverNode（[lib/audio.ts]の足音用リバーブ）に通し、館内で流れているような空気感を付与。控えめ（`GUIDE_REVERB_WET=0.18`、dryは全開）。`galleryAudio.connectGuide(el)`で`MediaElementSource→dry→master`＋`send→convolver`。**ブラウザ読み上げ（SpeechSynthesis）はWebAudioに通せず素のまま**（OpenAI音声のみ加工）。要点: `<audio>`に`crossOrigin='anonymous'`必須（`createMediaElementSource`はCORSなしで無音化。Supabaseは`ACAO:*`で可）。♪ミュート/離脱suspendはmaster経由で自動継承。
- 決定2（demoの人）: /demoは実訪問数が無いためゴースト0人だった→**固定4〜6人**の賑わいを表示（見せ場のため`visitor`ページの`MAX_GHOSTS=4`上限を意図的に超える）。`store.demoMode`を追加、`GalleryApp`が`demo`propで設定、`GhostVisitors`が`visitor`不在時に`demoMode`で固定人数を出す。人数は`4+random(0..2)`で起動時に固定。`!LOW_POWER`で低性能端末は自動オフ。
- 検証: tsc・buildクリーン。/demoで`demoMode:true`＋`visitor.glb/visitor2.glb`が200取得（フィギュア表示時のみ取得＝ゴースト生成の証拠）＋エラーなしを確認。リバーブの実音とゴーストの画角内目視は3D＋実音声要のため本番QA。

## 2026-07-22 読み上げ(音声ガイド)をOpenAI TTS化
- 決定: 現行のブラウザ読み上げ(Web Speech・無料)に代えて、既定をOpenAI TTS(`gpt-4o-mini-tts`)に。
- 生成タイミング=**初回再生時**にオンデマンド生成＋Supabase Storageキャッシュ(実際に聴かれた分だけ課金、2回目以降ゼロ)。ブラウザ読み上げは**フォールバックとして存置**(キー未設定/失敗/ネットワーク時)。
- 構成: `app/api/tts/route.ts`(サーバの`OPENAI_API_KEY`でOpenAIをfetch直叩き・新規ライブラリなし)。**乱用防止=任意テキスト不可**、`workId`を受けDBから実キャプションを引いて生成→生成対象は実在キャプションのみ・件数有限。キャッシュキー=`model+voice+text`のsha256、`artworks`バケットの`tts/{hash}.mp3`(公開読み)、HEADでヒット判定しupsert保存。未設定は501→クライアント(`lib/guide.ts`)がブラウザ読み上げにフォールバック、セッション内はURLをメモリキャッシュ。
- 声: `lib/guide.ts` の `TTS_VOICE` 1箇所で切替。**shimmerで確定**（2026-07-22 本番キー設定後に8ボイスのサンプルを聴き比べてユーザー選定）。
- **/demoもOpenAI音声**（2026-07-22 追記）: demoはDBでなく同梱`ARTWORKS`(id `a01`〜・約10件固定)を使うため、routeでDB照会前に`ARTWORKS`をid一致で先引き(demo idはuuidでないためDB先引きだとuuidキャストエラーになる回避も兼ねる)。demoキャプションもOpenAIで生成・キャッシュ(固定件数×1回のみ課金)。
- 要手作業: OpenAIでキー発行→VercelにENV `OPENAI_API_KEY`追加→再デプロイ。設定するまでは従来のブラウザ読み上げのまま(無害)。

## 2026-07-22 /me ダッシュボード全体を自動保存化＋保存トースト
- 背景: 実機確認でユーザーFB「Profileが保存できていない(Saveボタン押さないと保存されない)」「保存したらトーストを出して」。
- 決定1: **編集項目は全部自動保存**に。Profileの表示名/Bio/SNSを`editProfile`(900msデバウンス)で自動保存化し「Save profile」ボタン廃止。username(重複チェックあり)は手動Set/Change・アバターは即時のまま。Account(メール変更/パスワード/削除)は確認・破壊的操作なので手動据え置き。
- 決定2: **ダッシュボード全体で保存トースト**。`ToastContext`＋MePageのprovider＋`.me-toast`(下中央・金ドット・1.8秒・単一スロット)。全保存成功箇所で`toast()`を呼ぶ(Gallery: run/editDetails/editDesign/editPlacement/editCustom/editWork/BGM/username/WorkDesign、Profile: editProfile/username/avatar)。インライン"saved"は廃し"saving…"のみ残す(完了はトーストで示す)。
- 整理: 未使用化した`SectionSaveHeader`部品と`ReactNode` importを削除。
- 対象: `app/me/page.tsx`, `app/me.css`。tsc・buildクリーン、一時ハーネスでProfile無ボタン化・saving…・Savedトーストの発火を確認。

## 2026-07-22 /me Gallery微調整（保存の統一・サイドバー化）
- 背景: レビュー実機確認でユーザーから2点のFB。
- 決定1（保存）: **前回の「保存は現状維持」を撤回し、全部自動保存に統一**。自動保存と手動Saveの混在が気持ち悪いため。作品テキスト(タイトル/キャプション/価格/購入リンク/サイズ/画材)も展示タイトルと同じ900msデバウンス自動保存(`editWork`)に。Saveボタン＋スクロール追従保存バーを廃止。作品パネルに「saving…/saved」表示。payloadは呼び出し時確定なので作品切替中の保存もその作品に確定。
- 決定2（メニュー位置）: サブメニューを**ページ左端のサイドバー**に。1300px以上で左ガターへ張り出し(`.me-gallery-body`をrail footprint分だけ左へ負マージンで拡張、内容カードは上の識別カードと左右一致)。**railはin-flowのsticky**にして内容カードと上端を揃え＋スクロール追従(固定top決め打ちをやめた)。721〜1299pxは列内縦レール、≤720pxは内容上の横スクロールチップ列。
- 対象: `app/me/page.tsx`（editWork新設・saveWorkDetails/workSaved撤去・SectionSaveHeader action撤去・各onChangeをeditWorkへ）、`app/me.css`（min-width:1300のガター張り出し）。

## 2026-07-22 /me Galleryタブを左サブメニュー方式に再構成
- 背景: Galleryタブが1枚の長いカードに「①展示メタ ②部屋デザイン ③作品の中身 ④作品の見た目」を縦積みし、項目過多で使いづらい（特に額縁・キャプションが作品ごとに繰り返し）。
- 決定: Galleryタブ内に**二段目のサブメニュー**を設け、選択項目だけ右に編集表示するマスター/ディテール型に。
  - サブメニュー構成 = **「部屋」＋ 作品リスト**のみ。作品は1点ずつメニュー項目として列挙（サムネ＋タイトル、★=カバー）。初期5枠（`PLAN.worksPerGallery=5`）＋「作品を追加」導線＋スロット購入（+5）。スロット増で6件目以降が下に増える。
  - **作品サムネの横ストリップ（Works in this room）は廃止** → 左ナビが作品一覧を兼ねる。
  - 「部屋」= テーマ/レイアウト/照明/カスタムサイズ/配置/BGM。
  - 見た目（額縁・マット・掛け方・キャプション様式）は**各作品パネルに同居（作品ごとに別スタイル可）**。room defaultはテーマ推奨を初期値として自動適用、変えたい作品だけ上書き（既存 setOverride 流用）。
  - サブメニューは**カードの枠外**（上部タブ Gallery/Guestbook… の下、二段目のレール）に配置。PCは縦レール／スマホは上部横スクロールに自動切替（レスポンシブ）。
  - 3Dプレビューは**細いレール＋現行の「プレビュー｜設定」横並び維持**。
  - 保存は**現状維持**（テーマ/額縁/公開等は即時保存、作品テキスト=タイトル/キャプション/価格/サイズ/画材のみ選択作品パネル内のSaveボタンで保存。Saveは全体でなく選択中作品単位）。
- 却下: A案の「標準スタイル」部屋共通集約 = 作品ごとに額縁/掛け方が本来異なる（作品Aは木製額縁、Bは額縁なし等）ため実態に合わず却下。密度問題はサブメニューで1作品ずつ表示することで解決するため集約不要。「公開・共有」独立セクション化も却下（公開/URL/埋め込み/カタログ/削除は現状ヘッダー＋モーダルのまま）。上部タブ構成(Gallery/Guestbook/Profile/Account)は今回対象外。
- 対象: `app/me/page.tsx` のGalleryタブ再構成が主、`components/WorkDesign.tsx` は作品パネル内にそのまま組み込み。

## 2026-07-09 自己改善ループの導入
- 決定: user-interview-tool で構築した自己改善ループ（STATE/LESSONS/DECISIONS 台帳・/kaizen スキル・push前検証ループ）をこのリポジトリにも導入。リモート実行（claude.ai Webセッション）でも効くようリポジトリにコミットするハイブリッド構成
- 補足: 運用ルール本文は AGENTS.md、棚卸しスキルは .claude/skills/kaizen を参照

## 2026-07-21 本番ドメインを xibit360.art に確定
- 決定: ムームードメインで取得した `xibit360.art` を Vercel Production に割り当て。ムームーDNSにカスタムレコード（apex A `76.76.21.21` / www CNAME `cname.vercel-dns.com`）を設定して接続、SSLはVercel自動発行。
- 効果: ship時の反映確認は `https://xibit360.art` をポーリング（毎回デプロイURLを探さない）。埋め込みコードの `src` もこのドメインを使う。

## 2026-07-21 サービス名を HAKONIWA → Xibit360 に変更
- 決定: リブランド。表記ルール = ロゴ/マーク `XIBIT360`、文中/メタデータ `Xibit360`。ユーザーの1ギャラリーを指す普通名詞は `gallery`/`galleries`（日本語docは「ギャラリー」）。
- 実装: コード全体（app/components/lib/docs/supabase、計35ファイル）を一括置換。保存キーは `xibit360.*` に改名（既存ユーザーのローカル設定/いいね履歴はリセットされる点を合意のうえ）。package名 `xibit360`、`HakoniwaCard`→`GalleryCard`、`window.__hakoniwa`→`__xibit360`、録画DL名 `xibit360-walkthrough.webm`。ドメイン文字列は `xibit360.art`（TLDは .art）。
