# DECISIONS

## 現在の前提・絶対ルール
- **サービス名は Xibit360**（旧 HAKONIWA）。表記: ロゴ/マーク=`XIBIT360`（全大文字）、文中/メタデータ/OG=`Xibit360`（Title case）。ユーザーの1ギャラリーを指す普通名詞は英語UIで `gallery`/`galleries`、日本語docで「ギャラリー」。
- **本番の公開URLは https://xibit360.art**（ムームードメイン取得・Vercel Production）。ship時の反映確認はこのドメインをポーリングする。Vercelの自動生成URL（`*-projects.vercel.app` 等）はDeployment Protectionでログイン必須になり得るので共有・埋め込みには使わない。

## 並行セッションの担当
- （並行して動く別セッションの担当領域をここに記録する）

---

## 2026-07-22 読み上げ(音声ガイド)をOpenAI TTS化
- 決定: 現行のブラウザ読み上げ(Web Speech・無料)に代えて、既定をOpenAI TTS(`gpt-4o-mini-tts`)に。
- 生成タイミング=**初回再生時**にオンデマンド生成＋Supabase Storageキャッシュ(実際に聴かれた分だけ課金、2回目以降ゼロ)。ブラウザ読み上げは**フォールバックとして存置**(キー未設定/失敗/ネットワーク時)。
- 構成: `app/api/tts/route.ts`(サーバの`OPENAI_API_KEY`でOpenAIをfetch直叩き・新規ライブラリなし)。**乱用防止=任意テキスト不可**、`workId`を受けDBから実キャプションを引いて生成→生成対象は実在キャプションのみ・件数有限。キャッシュキー=`model+voice+text`のsha256、`artworks`バケットの`tts/{hash}.mp3`(公開読み)、HEADでヒット判定しupsert保存。未設定は501→クライアント(`lib/guide.ts`)がブラウザ読み上げにフォールバック、セッション内はURLをメモリキャッシュ。
- 声: `lib/guide.ts` の `TTS_VOICE='alloy'` 1箇所で切替。キー設定後に数ボイスのサンプルを生成して聴き比べ→確定予定。
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
