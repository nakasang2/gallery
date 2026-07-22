# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-22（3D Gallery: Others展開でbase非表示／壁を詳細UI化／壁hoverカーソル）

## 進行中
- なし

## 次にやること（再開ポイント）
- **Stripe本番接続の運用作業**（コードは完成・未接続）: `0019_checkout.sql`適用 → `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SITE_URL` 設定 → Stripe CLIで実カード確認（手順は supabase/README §5）
- docs/STRATEGY.md **§7** の残タスク:
  - P1-5 有料テーマ/レイアウト第1弾。前提(FOREVER_FREE固定化)は**解消済**。残るは実際の有料テーマ/レイアウトの制作という事業/制作判断
  - P2-8 ウォークスルー動画は**実装済**。フォローアップ: MP4/GIF変換(X/IG直投稿用。要ffmpeg.wasm/サーバ)・録画に音声を載せる
  - P2-9 企画展(特集)は**実装済**。運用: `/admin`で特集を設定するだけ。フォローアップ候補: 期間の自動切替・作家からの応募フロー
  - P2-10 記事/ガイド機能は**実装済**(migration 0020)。運用: `/admin`の「Guides」で執筆・公開するだけ。「Ktlyst参考に」の指定は同名企業が複数あり特定できず・候補サイトも403のため、Xibit360自身のデザインで実装(参考URLをもらえれば個別に寄せる)。フォローアップ候補: 記事内の作品/ギャラリー埋め込み、タグ/カテゴリ、関連記事
  - P3-12 音声ガイド=**作品ごとガイド実装済**(migration 0021)。空間BGM=**案A実装済**(作家が音源アップ→1トラックloop、migration 0027)。残フォローアップ: 案B(権利処理済みアンビエント音源のライブラリ内蔵)。※市販曲のInstagram型は包括ライセンスが要り個人規模では非現実的(2026-07-21相談で確認)
  - P3-11 グループ展(卒展向け・最高価値)は**設計判断待ち**: 「複数作家でどう共同編集するか」(招待制の共同編集 / 主催者が他人の公開作品をキュレーション)。Stripe本番にも依存
  - P3-13 AR / P3-14 立体(glTF)
- レビューで見送った低優先の既知事項:
  - 署名なし決済フローで未サインイン時に「Checkout isn't live yet」と表示（現状モーダルはサインイン文脈でしか開かず到達不可）
  - 購入完了後の再取得はギャラリー（キャパ）のみ更新。テーマ/レイアウト所有は要手動リロード（バナーで案内済み・現状テーマ購入は到達不可）
- Q2の残り: `/me`のalert/confirmは意図的にネイティブのまま（没入を壊さないため対象外）
- U3（WebGL対応環境でのキーボード/スクリーンリーダー回遊）は未対応（非WebGLの2Dフォールバックのみ）

## 注意（並行セッション・未コミット変更）
- なし

## 完了ログ（直近5件）
- 2026-07-22: **3D Gallery UI追い込み3点**。ユーザー指示。①Others展開中は base アクション(BGM/Share/Guestbook)を隠しサブメニューのみ表示(`.hud-base`+`.others-open`／`:has(.hud-others:hover)`)。②タイトル壁をクリック可能にし作品同様の詳細パネル`InfoPanel`(Exhibition/タイトル/statement/作家bio)を開く。store に `infoOpen`/`setInfoOpen` 追加(他ドロワーと排他)、GalleryAppで描画、HUD/ステッパー/ヒントは infoOpen 時も tuck。③壁 hover でカーソル pointer(作品と同一 onOver/onOut。作品側は既存対応)。`/demo`実機で3点とも確認(infoOpen発火・base非表示)。tsc・buildクリーン。※プレビュークリックの座標系は 691×784(CSS)で、デバイスpxではない点に注意(検証時ハマった)。
- 2026-07-22: **3D Gallery HUDの刷新**。ユーザー指示。①左上テキストをサービス名(XIBIT360)＋展示名＋展示者のみに（@ユーザー名/SNS/Explore/Report撤去）。②右下に統一アクションクラスタ新設(左下のRecordも統合): BGM/SHARE/GUESTBOOK/OTHERS(→REPORT/RECORD)。既定はアイコン+丸、hover/focusでラベル付きカプセルに拡張(`@media (hover:hover)`でタッチは丸のままタップ即実行)、OTHERSはhover/タップで上にサブメニュー。③SHARE新規: `navigator.share`対応時はOS共有シート、非対応時は公開URLコピー+トースト。④`RecordButton`を`useWalkRecorder`フック化しクラスタから駆動(GalleryApp単独描画を廃止)。モード差: visitor=全部、demo/owner=該当分のみ。tsc・buildクリーン、静的ハーネス＋/demoでコンソールエラー無しを確認。※visitor実画面(全ボタン/実共有・録画・記帳)は認証・実データ・3D要のため本番QA。
- 2026-07-21: **空間BGM(案A)実装＋Placementツールチップ化＋Preview削除/Copyアイコン化**。①空間BGM(§P3-12): 作家がギャラリーごとに音源1つをアップ→来訪者の歩行中に1トラックloop。既存`galleryAudio`(WebAudio)にBGMレイヤー(fetch→decode→loop BufferSource→専用gain→**master経由**)を追加し、HUDの♪ミュート・入退室suspendが自動で効く。migration `0027`(galleries.bgm_url、未適用でも読みはフォールバックで無害)、`uploadGalleryBgm`、`saveGalleryBgm`、`PublicExhibition.bgmUrl`、GalleryAppの入室で`setBgm`起動、ダッシュボードTheme節に「Ambience」行(権利注意書き付)。未設定は無音。②「Placement」の冗長説明をⓘツールチップ化(§11.29機構を`.me-field`外へ汎用化)。③「Preview in 3D」は自分の展示でなく/demoを開くミスマッチで削除、「Copy URL」ボタンをURL横のコピーアイコン(押下でチェック)に。tsc・buildクリーン、認証必須UIは一時harnessで検証。※本番でBGMアップロードを使うにはmigration 0027適用要。
- 2026-07-21: **ダッシュボードの3Dプレビュー整列＋Saveボタンをタブ間で統一**。ユーザー指摘2点: ①3D viewが片方だけ左はみ出す ②タブごとにSaveの建て付けが違う。原因: ①§11.27で作品プレビューを`.art-section .works-detail`に-1.6rem breakout+border除去でカード端bleedさせた名残で、Theme側(インセット)と非対称 ②galleryのSaveは`.wd-save-cta`(ゴールド全幅sticky)、profileは`.btn-line`(素の細ボーダー)。対処: ①`.art-section`の breakout/border上書き(desktop+mobile)を撤去し両プレビューをインセット統一 ②profileの「Save profile」を`.wd-save-cta`化(非sticky、galleryはsticky維持)。認証必須の`/me`は実描画不可のため一時ルート`app/harness`で実CSS検証(両プレビュー左端一致＋ゴールドボタン)→削除。build クリーン。実ダッシュボードの最終確認はユーザー。
- 2026-07-21: **LPフッターの3D透け修正＋動画パス仕様の確認**。ユーザー報告「LPフッターが良くない」。原因: 固定3Dヒーロー(HeroCanvas)がページ全体の背後に常駐するのに `.footer` に background 指定がなく、3Dシーンが透過して雑然。対処: `.footer` に `background: var(--bg)`（`::before` 継ぎ目グラデが向かう色と一致）。ローカル＋本番で `getComputedStyle(.footer).backgroundColor=rgb(11,10,9)`・見た目クリーンを確認。build クリーン。あわせてユーザー質問に回答: 動画パスは`videoEnabled=videoPass`のアカウント単位ON/OFF＝1回購入で動画展示解禁・本数は通常の作品枠しだい(制約は1ファイル40MB＋総ストレージのみ)、1本制限ではない。

