# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-14（P0-2/P0-3/P1-4 Stripe/P1-6 embed を実装。/code-review 指摘2件を修正）

## 進行中
- なし

## 次にやること（再開ポイント）
- **Stripe本番接続の運用作業**（コードは完成・未接続）: `0019_checkout.sql`適用 → `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SITE_URL` 設定 → Stripe CLIで実カード確認（手順は supabase/README §5）
- docs/STRATEGY.md **§7** の残タスク:
  - P1-5 有料テーマ/レイアウト第1弾。**前提**: `lib/entitlements`のFOREVER_FREEを固定スナップショット化（現状`Object.keys(THEMES)`で全テーマ永久無料=ロック不能。theme_collection購入も現状は空grant）
  - P1-7 PDFカタログ出力 / P2 成長ループ（ウォークスルー動画・企画展）
- レビューで見送った低優先の既知事項:
  - 署名なし決済フローで未サインイン時に「Checkout isn't live yet」と表示（現状モーダルはサインイン文脈でしか開かず到達不可）
  - 購入完了後の再取得はギャラリー（キャパ）のみ更新。テーマ/レイアウト所有は要手動リロード（バナーで案内済み・現状テーマ購入は到達不可）
- Q2の残り: `/me`のalert/confirmは意図的にネイティブのまま（没入を壊さないため対象外）
- U3（WebGL対応環境でのキーボード/スクリーンリーダー回遊）は未対応（非WebGLの2Dフォールバックのみ）

## 注意（並行セッション・未コミット変更）
- なし

## 完了ログ（直近5件）
- 2026-07-14: 戦略ロードマップ§7を実装。P0-2「AI学習に使わない」明文化(Terms/Privacy/LP)・P0-3マルチプレイ低優先度注記・P1-4 Stripe決済(Checkout+署名検証Webhook+冪等RPC `record_capacity_purchase`/migration 0019、未設定時フォールバック)・P1-6 embed(`?embed=1`+iframeコピーUI+認証ルートのframe拒否)。/code-review高で5指摘→CONFIRMED2件修正(キャパ購入の記録喪失を冪等RPCで解消/クリックジャッキング防止ヘッダー)。tsc・build・実挙動(501/401/400・embed HUD・frameヘッダー)検証済
- 2026-07-14: 競合を調査し docs/STRATEGY.md（競合分析・販売戦略・機能ギャップ・優先度順タスクリスト§7）を作成
- 2026-07-14: LPヒーローに右の3点目を追加（構図バランス）＋ LP表示作品を`/admin`から設定可能に（migration 0018 `site_config`：公開read/admin write）。中央/左/右3枠に画像アップロード→未設定はデモ作品にフォールバック、PC/モバイル共通。`HeroScene`は設定画像をテクスチャ描画（`FramedImage`）、`components/LpHeroEditor`で編集。tsc/build/描画（LP無リグレッション＋編集UIをスクショ）検証済み。※実画像の差し替え反映は実Supabaseでのみ最終確認可
- 2026-07-14: 管理画面 `/admin` を追加（migration 0017: `admins`表・`is_admin()`・管理者横断read・売上金額列）。総課金額・ユーザー別保有パッケージ・全展示空間（非公開含む）を表示。方式はDB adminsテーブル+RLS（既存SPA/anon+RLS構成に一致、クライアント自己昇格経路なし）。決済未接続のため総課金額は¥0だが、`purchases.amount_jpy`で集計基盤は用意。tsc/build/描画（モックでスクショ）検証済み。※RLSの管理者ゲート実挙動は実Supabaseでのみ最終確認可
- 2026-07-13: デモ→戻ると環境音が鳴り止まないバグを修正。`galleryAudio`（モジュールsingleton）にsuspend/resumeを追加し、`GalleryApp`アンマウントで停止（master gain即0＋`ctx.suspend()`）。動画音声側も`suspendVideoAudio`で対称化。Playwright+同梱Chromiumで離脱後`suspended`を実挙動検証
- 2026-07-13: リリース品質化。ランディング料金表を実モデル（無料5点+買い切り3軸+Video Pass年額）へ是正／オーナーが`/demo`を開いた時のHUDを自分の展覧会に切替＋デモ作品の混在を除外（派生状態で実装しサインアウト時の副作用を回避）／3D没入中のalert()を非ブロッキングtoastへ（`lib/toast.ts`）／"ten artists"→"ten works"。tsc・next build・全ルートのスモーク(200/404)確認済み
