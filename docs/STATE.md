# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-24（価格モデルをUSD化・スロット従量制・Design Tools無料化・全レイアウト15枠に。未push）

## 進行中
- **Stripe決済の本番有効化**（DECISIONS 2026-07-24参照、本番モード＋Xibit360専用の新規アカウントで確定）。Claude済: `NEXT_PUBLIC_SITE_URL=https://www.xibit360.art`設定。ユーザー待ち: ⓪同じログイン下にXibit360専用アカウントを新規作成し本番有効化 ①`0019_checkout.sql`をSupabase SQL Editor適用 ②新アカウント(live)の`STRIPE_SECRET_KEY`(sk_live_)をVercelに ③新アカウントでWebhook作成(`https://www.xibit360.art/api/stripe/webhook`・`checkout.session.completed`)→`STRIPE_WEBHOOK_SECRET`(whsec_)をVercelに ④価格USD化に伴い`0028_capacity_clamp.sql`もSQL Editorで適用。完了後Claudeが再デプロイ＋疎通検証(checkout=401/webhook=400)、実カードで**スロット追加($3〜)購入→返金**でE2E確認（USD化で¥580→$3/枚に変更済み）。
- ゴースト円形接地影の削除はローカルコミット済み(4027e8b)・未push。価格USD化一式も未push。

## 次にやること（再開ポイント）
- **描画品質ティアの実機QA**: low/mediumティア（スマホ）はローカルでポインタエミュ不可のため未検証。本番反映後、実スマホで①普通のスマホ=影あり(1024)・反射なし ②古い/安いスマホ=影なし＋疑似影のみ、のフレームレートと見た目を確認（DECISIONS 2026-07-23参照）
- **読み上げTTS**: 本番ENV(`OPENAI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY`)設定済み。`/api/tts`は本番で200・mp3公開再生可・キャッシュ動作を確認済み。ボイスは**shimmer確定**。残: アプリ実画面での再生体験（ツアー▶/作品ガイド）＆日本語キャプションでの発音は本番QAで最終確認。
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
- 2026-07-24: **価格モデルの作り替え（USD化・スロット従量制・Design Tools無料化・全レイアウト15枠）**（DECISIONS 2026-07-24参照）。全価格をUSDセント整数へ、スロットは$3/枚の数量ピッカー（1部屋最大15枚）、テーマ/レイアウト$5、Design Toolsは全員無料（販売撤去）、hall/corridor/island/portraitを各15スロットに統一。並行購入でwork_capが15超過し得る穴を migration 0028（RPCで`least(...,15)`）で封鎖。tsc/build/別視点レビュー通過、/demoで4レイアウト実機確認。**未push・migration 0028未適用**。ゴースト影削除・Theme Collection撤去も同梱の未pushコミットあり。
- 2026-07-24: **【ship済・本番反映確認】作品鑑賞UI一式＋ピクチャーライト修正**（7コミット、DECISIONS 2026-07-24参照）。①overheadピクチャーライトを仮想光源方式に再設計（白飛び/光幅/影を一括解決）②`‹ ›`ステッパーを作品フォーカス中は隠しPrev/Nextをパネル内へ移設③作品クリックの鑑賞は「View in 3D」ボタン→**額縁ごと拡大・回転できる全画面3Dプレビュー**（新規`ArtworkPreview3D.tsx`＝遅延ロード専用Canvas＋drei OrbitControls、`Exhibit`の`makeFrameGeo`再利用、開幕は引き→正面のドリーイン`IntroDolly`、reduced-motion配慮）。当初の2D図版案は「3Dと二重」で撤去。ship前レビューで3件（動画posterリーク/poster無しfallback/frameGeo churn）を修正。tsc・next buildクリーン、www.xibit360.art/demo 200確認。
- 2026-07-23: **壁影のライトマップ焼き込み(案C)**（DECISIONS 2026-07-23参照）。WallShadowBaker新設: 巡回ベイクライトで各作品の実シルエット影(額縁/ワイヤー/プレート)を256pxテクスチャへ順次焼き込み(sampler2DShadowハードウェア比較＋16タップPCF)、完了後の常駐影ライトはベンチ2灯のみ=テクスチャユニット問題が構造的に消滅。mediumティアにも実影。レビュー3件(r185深度パッキング誤り・mediumゲート回帰・bakeKey不足)を出荷前修正。動的シャドウ予算は撤去。tsc/buildクリーン、/demoでceiling/overhead両モード実機確認。
- 2026-07-23: **デモ10作品化＋自動配置バランス化＋影ライト予算制**（DECISIONS 2026-07-23参照）。見本市はスロット上限解除で10作品、自動配置は壁交互・中央寄せ（5作品=北2南2東1）、手動配置は完全互換。作品10個で影12灯→テクスチャユニット16超過で真っ黒になる事故を予算制(7灯)で解消。レビュー検出3件（縮小時の作品消滅・配置マップ切り捨て・アップロード後グライド先）も修正。tsc/buildクリーン、/demoでchic/whitecube実機確認。
