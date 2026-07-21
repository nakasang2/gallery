# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-21（LPフッターの3D透けを修正・本番反映／動画パス仕様=アカウント解禁を確認）

## 進行中
- なし

## 次にやること（再開ポイント）
- **Stripe本番接続の運用作業**（コードは完成・未接続）: `0019_checkout.sql`適用 → `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SITE_URL` 設定 → Stripe CLIで実カード確認（手順は supabase/README §5）
- docs/STRATEGY.md **§7** の残タスク:
  - P1-5 有料テーマ/レイアウト第1弾。前提(FOREVER_FREE固定化)は**解消済**。残るは実際の有料テーマ/レイアウトの制作という事業/制作判断
  - P2-8 ウォークスルー動画は**実装済**。フォローアップ: MP4/GIF変換(X/IG直投稿用。要ffmpeg.wasm/サーバ)・録画に音声を載せる
  - P2-9 企画展(特集)は**実装済**。運用: `/admin`で特集を設定するだけ。フォローアップ候補: 期間の自動切替・作家からの応募フロー
  - P2-10 記事/ガイド機能は**実装済**(migration 0020)。運用: `/admin`の「Guides」で執筆・公開するだけ。「Ktlyst参考に」の指定は同名企業が複数あり特定できず・候補サイトも403のため、Xibit360自身のデザインで実装(参考URLをもらえれば個別に寄せる)。フォローアップ候補: 記事内の作品/ギャラリー埋め込み、タグ/カテゴリ、関連記事
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
- 2026-07-21: **LPフッターの3D透け修正＋動画パス仕様の確認**。ユーザー報告「LPフッターが良くない」。原因: 固定3Dヒーロー(HeroCanvas)がページ全体の背後に常駐するのに `.footer` に background 指定がなく、3Dシーンが透過して雑然。対処: `.footer` に `background: var(--bg)`（`::before` 継ぎ目グラデが向かう色と一致）。ローカル＋本番で `getComputedStyle(.footer).backgroundColor=rgb(11,10,9)`・見た目クリーンを確認。build クリーン。あわせてユーザー質問に回答: 動画パスは`videoEnabled=videoPass`のアカウント単位ON/OFF＝1回購入で動画展示解禁・本数は通常の作品枠しだい(制約は1ファイル40MB＋総ストレージのみ)、1本制限ではない。
- 2026-07-21: **サービス名を HAKONIWA → Xibit360 にリブランド＋本番ドメイン xibit360.art 確定**。ユーザー指示。表記ルール: ロゴ/マーク=`XIBIT360`、文中/メタ=`Xibit360`、普通名詞(ユーザーの1ギャラリー)=`gallery`/`galleries`(日本語doc「ギャラリー」)。中央定数がなく約150箇所に直書きだったため、安全な決定的置換(ドメイン`xibit360.art`・保存キー`xibit360.*`・package名・`HakoniwaCard`→`GalleryCard`・`__hakoniwa`→`__xibit360`・録画DL名)をスクリプトで先行、文脈判断が要る分(ロゴ/文中判別・普通名詞化・箱庭→ギャラリー)はサブエージェントに詳細仕様で一括実行させ、計35ファイル変更。保存キー改名で既存ユーザーのローカル設定/いいねはリセット(合意済)。壊れていた`.claude/launch.json`の`--strictPort`も除去。tsc・build・旧ブランド残存0・TLD誤り0を確認、ローカルLPで表記を実画面確認。DECISIONS.mdに本番URLと表記ルールを恒久記録。
- 2026-07-21: **`/@name?embed=1` が埋め込みモードにならないバグを修正**。ユーザーが埋め込みコードの動作確認を依頼。プレビューで2つ判明: ①本番URLがVercel Deployment Protectionでログイン必須（ユーザーが解除済） ②`app/[handle]/page.tsx` が `searchParams` を読まず、公開ギャラリー1つの作家(=`/@name`が直接ギャラリー)で `VisitorGallery` に `embed` を渡していなかった→埋め込み時もフルHUD。ダッシュボードのEmbedボタンは `/@name?embed=1` を生成するのに受け側が未対応だった。対処: `[slug]/page.tsx` と同じく `?embed=1` をhonorし `embed={embed==='1'}` を渡す。本番 `gallery-two-xi.vercel.app` で右上が「Start free」→「Open↗」・ヘッダー省略を確認。tsc・buildクリーン。※安定した公開ドメインは `gallery-two-xi.vercel.app`（DECISIONS要検討: 本番URLの確定）
- 2026-07-21: **別セッションのダッシュボードUIを #6 で main へ統合＋孤児3Dモデル528MB削除＋ⓘラベル回帰修正**。別デバイスで進めていたダッシュボードUI（§11.24〜§11.29）をPR #6で main へ。作業前に環境へgit-lfs未導入でpullが中途破損→`brew install git-lfs`+`git lfs install`後 `reset --hard origin/main` で復旧。マージ前レビューで §11.29 のⓘツールチップに回帰を検出（`<label>`内で入力欄より前に`<button>`を置き、labelableな最初の子=ボタンにラベル関連付けが奪われ、入力欄がアクセシブルネーム喪失＋ラベルクリックが入力欄でなくⓘにフォーカス）→トリガーを`button`→`span(role=note, tabIndex=0)`化し実DOMで `label.control=TEXTAREA` 復帰を確認。未参照の `idle/idle2/walk/walk2.glb` 計528MBを `git rm`（`visitor.glb`/`visitor2.glb` に一本化済で参照ゼロ）。`tsc`・`build`クリーン。#6はsquashマージ・ブランチ削除済。※本番反映に migration `0025`/`0026` 適用要
- 2026-07-18: **入力欄の補足をラベル横のⓘに集約（§11.29）**。ユーザー「入力欄の補足テキストがごちゃごちゃ。補足はアイコンをラベル横に」。§11.28でPrice追加後、作品設定フォームの各ラベルが一文を抱えて縦に説明が積んでいた。対処: `FieldLabel`ヘルパ新設(ラベルは1〜2語、横の`ⓘ`=`InfoIcon`にhint格納・hover/tapで吹き出し)を Caption/Price/Purchase link/Medium に適用。CSSは`.me-field-label`をflex化・`.field-hint`(hover/focusでgold)・`.me-field .field-hint-pop`で`.me-field span`のuppercase等を打ち消した暗bg吹き出し。対象外: 動的値のEmail/Username・別カードのConcept。`/qa-hint`軽量QAで整列+hover吹き出しをスクショ確認・削除済み。`tsc`・`build`クリーン

