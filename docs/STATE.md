# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-21（`/@name?embed=1` が埋め込みモードにならないバグを修正・本番反映確認）

## 進行中
- **本番ドメイン設定待ち（ユーザー作業）**: Vercelで独自ドメインをProductionに割り当て中。完了後の再開ポイント → ①確定した公開URLを docs/DECISIONS.md に記録（ship時の反映確認で毎回探さないため）②その新ドメインで `/@name?embed=1` を開き、Embedボタンが生成するURL（`location.origin`ベース）が新ドメインになること＋埋め込みHUD（右上「Open↗」）を実画面確認。暫定の公開ドメインは `gallery-two-xi.vercel.app`

## 次にやること（再開ポイント）
- **Stripe本番接続の運用作業**（コードは完成・未接続）: `0019_checkout.sql`適用 → `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SITE_URL` 設定 → Stripe CLIで実カード確認（手順は supabase/README §5）
- docs/STRATEGY.md **§7** の残タスク:
  - P1-5 有料テーマ/レイアウト第1弾。前提(FOREVER_FREE固定化)は**解消済**。残るは実際の有料テーマ/レイアウトの制作という事業/制作判断
  - P2-8 ウォークスルー動画は**実装済**。フォローアップ: MP4/GIF変換(X/IG直投稿用。要ffmpeg.wasm/サーバ)・録画に音声を載せる
  - P2-9 企画展(特集)は**実装済**。運用: `/admin`で特集を設定するだけ。フォローアップ候補: 期間の自動切替・作家からの応募フロー
  - P2-10 記事/ガイド機能は**実装済**(migration 0020)。運用: `/admin`の「Guides」で執筆・公開するだけ。「Ktlyst参考に」の指定は同名企業が複数あり特定できず・候補サイトも403のため、HAKONIWA自身のデザインで実装(参考URLをもらえれば個別に寄せる)。フォローアップ候補: 記事内の作品/箱庭埋め込み、タグ/カテゴリ、関連記事
  - P3-12 音声ガイドは**作品ごとガイドを実装済**(migration 0021)。残: 空間BGM(WebAudio経由・1トラックloop)
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
- 2026-07-21: **`/@name?embed=1` が埋め込みモードにならないバグを修正**。ユーザーが埋め込みコードの動作確認を依頼。プレビューで2つ判明: ①本番URLがVercel Deployment Protectionでログイン必須（ユーザーが解除済） ②`app/[handle]/page.tsx` が `searchParams` を読まず、公開ギャラリー1つの作家(=`/@name`が直接ギャラリー)で `VisitorGallery` に `embed` を渡していなかった→埋め込み時もフルHUD。ダッシュボードのEmbedボタンは `/@name?embed=1` を生成するのに受け側が未対応だった。対処: `[slug]/page.tsx` と同じく `?embed=1` をhonorし `embed={embed==='1'}` を渡す。本番 `gallery-two-xi.vercel.app` で右上が「Start free」→「Open↗」・ヘッダー省略を確認。tsc・buildクリーン。※安定した公開ドメインは `gallery-two-xi.vercel.app`（DECISIONS要検討: 本番URLの確定）
- 2026-07-21: **別セッションのダッシュボードUIを #6 で main へ統合＋孤児3Dモデル528MB削除＋ⓘラベル回帰修正**。別デバイスで進めていたダッシュボードUI（§11.24〜§11.29）をPR #6で main へ。作業前に環境へgit-lfs未導入でpullが中途破損→`brew install git-lfs`+`git lfs install`後 `reset --hard origin/main` で復旧。マージ前レビューで §11.29 のⓘツールチップに回帰を検出（`<label>`内で入力欄より前に`<button>`を置き、labelableな最初の子=ボタンにラベル関連付けが奪われ、入力欄がアクセシブルネーム喪失＋ラベルクリックが入力欄でなくⓘにフォーカス）→トリガーを`button`→`span(role=note, tabIndex=0)`化し実DOMで `label.control=TEXTAREA` 復帰を確認。未参照の `idle/idle2/walk/walk2.glb` 計528MBを `git rm`（`visitor.glb`/`visitor2.glb` に一本化済で参照ゼロ）。`tsc`・`build`クリーン。#6はsquashマージ・ブランチ削除済。※本番反映に migration `0025`/`0026` 適用要
- 2026-07-18: **入力欄の補足をラベル横のⓘに集約（§11.29）**。ユーザー「入力欄の補足テキストがごちゃごちゃ。補足はアイコンをラベル横に」。§11.28でPrice追加後、作品設定フォームの各ラベルが一文を抱えて縦に説明が積んでいた。対処: `FieldLabel`ヘルパ新設(ラベルは1〜2語、横の`ⓘ`=`InfoIcon`にhint格納・hover/tapで吹き出し)を Caption/Price/Purchase link/Medium に適用。CSSは`.me-field-label`をflex化・`.field-hint`(hover/focusでgold)・`.me-field .field-hint-pop`で`.me-field span`のuppercase等を打ち消した暗bg吹き出し。対象外: 動的値のEmail/Username・別カードのConcept。`/qa-hint`軽量QAで整列+hover吹き出しをスクショ確認・削除済み。`tsc`・`build`クリーン
- 2026-07-18: **Title&caption上border除去/フレーム最小1cm/作品価格の設定（§11.28）**。ユーザー3点: ①アート設定のtitle&caption上のborderも消す ②フレームthicknessのminを1cmに ③価格を設定できるように。対処: ①設定カラム先頭の`Title & caption`を`.wd-group`→`.wd-group--flush`(border-top等0) ②`FRAME_BAR_MM.min`を30→10mm(カスタム額装キーのmmは`\d{2,3}`=2〜3桁なので10が安全な最小) ③`ArtworkData.price?:string`自由入力・`cloud.ts`(row/rowToArtwork/updateArtworkDetails・OPTIONALに'price')・migration `0026_artwork_price.sql`・ダッシュボードに`priceInput`(seed/保存/dirty、Title&caption内Purchase linkの上)・作品パネルは購入リンク有=前置/無=`.panel-price`単独。`tsc`・`build`クリーン。※本番反映にmigration 0026適用要
- 2026-07-17: **保存ボタンsticky footer化/Editing文削除/プレビューをカード端へブリード（§11.27）**。ユーザー3点: ①保存は全体にかかるのでbottom固定・下端で解放(sticky) ②「Editing "◯◯" — …」文不要 ③3Dプレビューをボーダー外へ。対処: ①保存を`me-card`直下のsticky footer(`.wd-save-sticky` position:sticky bottom:1rem)へ移設・art-section後に配置(スクロール中は下端固定・カード終端で解放) ②該当me-note削除+唯一の参照`syncState`も撤去 ③`.art-section .works-detail`を左右-1.6remでbreakout・設定カラムはpadding戻し・プレビューborder除去で左カード端までブリード。軽量QAで上/下スクロールの固定・解放、Editing文なし、ブリードを確認・削除済み。tsc・build クリーン

