# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-13（UX/ビジネス/QAレビュー起点のリリース品質化）

## 進行中
- なし

## 次にやること（再開ポイント）
- 決済（Stripe）連携は依然未実装。購入モーダルは「Checkout isn't live yet」の正直表示のまま
- Q2の残り: `/me`（ダッシュボード）のalert/confirmは意図的にネイティブのまま（没入を壊さないため対象外）
- U3（WebGL対応環境でのキーボード/スクリーンリーダー回遊）は未対応（非WebGLの2Dフォールバックのみ）

## 注意（並行セッション・未コミット変更）
- なし

## 完了ログ（直近5件）
- 2026-07-14: 管理画面 `/admin` を追加（migration 0017: `admins`表・`is_admin()`・管理者横断read・売上金額列）。総課金額・ユーザー別保有パッケージ・全展示空間（非公開含む）を表示。方式はDB adminsテーブル+RLS（既存SPA/anon+RLS構成に一致、クライアント自己昇格経路なし）。決済未接続のため総課金額は¥0だが、`purchases.amount_jpy`で集計基盤は用意。tsc/build/描画（モックでスクショ）検証済み。※RLSの管理者ゲート実挙動は実Supabaseでのみ最終確認可
- 2026-07-13: デモ→戻ると環境音が鳴り止まないバグを修正。`galleryAudio`（モジュールsingleton）にsuspend/resumeを追加し、`GalleryApp`アンマウントで停止（master gain即0＋`ctx.suspend()`）。動画音声側も`suspendVideoAudio`で対称化。Playwright+同梱Chromiumで離脱後`suspended`を実挙動検証
- 2026-07-13: リリース品質化。ランディング料金表を実モデル（無料5点+買い切り3軸+Video Pass年額）へ是正／オーナーが`/demo`を開いた時のHUDを自分の展覧会に切替＋デモ作品の混在を除外（派生状態で実装しサインアウト時の副作用を回避）／3D没入中のalert()を非ブロッキングtoastへ（`lib/toast.ts`）／"ten artists"→"ten works"。tsc・next build・全ルートのスモーク(200/404)確認済み
- 2026-07-09: 自己改善ループを導入（AGENTS.md / docs台帳 / .claude/skills/kaizen）
