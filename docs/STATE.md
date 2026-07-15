# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-14（P3-12 作品ごと音声ガイドを実装。P0〜P2-10も同日実装済み）

## 進行中
- なし

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
- 2026-07-14: P3-12 作品ごと音声ガイド。鑑賞パネルに再生/一時停止ボタン、ガイドツアー中は各作品にフォーカスした瞬間に自動再生(タップ起点なのでautoplay可)。migration 0021(`artworks.audio_url`)。`lib/guide.ts`=HTMLAudioElement singleton(WebAudioグラフ非経由でCORS/アップロード両対応、`useGuidePlaying`フック、mute連動=`galleryAudio.enabled`、退出・unmountで`suspend()`)。`lib/cloud.ts`に`uploadArtworkAudio`(15MB上限+quota)、`updateArtworkDetails`をaudio_url対応(purchase_urlと同じgraceful degradation)。ダッシュボードの「Title & caption」にアップロード/差替/削除UI。同梱Chromiumで実HTMLAudio再生を検証(play→playイベントで再生確認・toggle停止・**mute時は再生されない**・エラー0)。バグ修正: ツアー中にガイド無し作品へ移ると前作品のガイドが鳴り続ける件を、フォーカス/ツアー変化時に必ずstopするよう修正。tsc・build クリーン。残:空間BGM
- 2026-07-14: P2-10 記事/ガイド機能(SEO集客)。`/articles`一覧+`/articles/[slug]`(SEO/OGP・ファネルCTA)、`/admin`の「Guides」でMarkdown執筆・下書き/公開トグル・ライブプレビュー・削除(`components/ArticlesEditor`)。migration 0020(`articles`表・公開read/admin write RLS)。`lib/blog.ts`(公開一覧/slug取得/admin CRUD、graceful degradation)。**zero-dep・XSS安全のMarkdownレンダラ**`lib/markdown.tsx`(見出し/段落/太字/斜体/コード/リンク/画像/リスト/引用/コードブロック/hrをReact要素へ、dangerouslySetInnerHTML不使用、URLサニタイズ)。ナビ導線(LP nav/footer・Explore footer)。同梱Chromiumで全MD要素の描画・エディタUIを実挙動検証(h3/h4・bold/em・code・2リンク・ul/ol計6li・blockquote・hr・figure、内部リンクは同タブ)、エラー0。tsc・build クリーン。「Ktlyst」は特定できずHAKONIWA自身のデザインで実装
- 2026-07-14: P2-9 Explore特集(spotlight)メカニズム。`/explore`上部に手動キュレーションの特集枠、`/admin`の「Explore spotlight」で@username/slug・見出し・順序を編集(`site_config`のexplore_spotlightキー・migration不要)。`lib/publish`の`fetchPublicFeed`から`buildFeedItems`を抽出して`fetchSpotlightGalleries`と共有、FeedカードをFeedCardに抽出。`siteConfig`をhookフリー化(server import可に。`useLpHero`は唯一の利用者HeroSceneへ移設)。未公開refは自動脱落・graceful degradation。同梱Chromiumで特集表示(3カード)・adminエディタ(行追加/編集)を実描画検証、エラー0。tsc・build クリーン
- 2026-07-14: P2-8 ウォークスルー動画書き出し。順路ツアーを走らせつつ`MediaRecorder`+`canvas.captureStream`でWebM録画→DL(`lib/recorder.ts`/`components/gallery/RecordButton.tsx`/canvasを`controller.canvasRef`で露出)。非対応ブラウザはボタン非表示(mimeで判定)。バグ回避: 支持判定は`canvasRef`(mount時null)でなくmime能力で行い、canvasは click時に再確認。録画ボタンはminimapと衝突しない位置に配置。同梱Chromium(swiftshader)で実挙動検証: 有効なWebM(vp9・EBMLマジック1a45dfa3・32KB・正しいファイル名)を生成、idle/recording状態遷移、エラー0。tsc・build クリーン。既知の限界: WebMのみ(X/IGはMP4要変換)・無音
- 2026-07-14: P1-5前提解消(`lib/entitlements`のFOREVER_FREEを`Object.keys`→固定リスト['chic','whitecube','noir']/['hall','corridor','island','portrait','custom']化、dev guard付き。以後の新テーマは自動でロック対象)+ P1-7 PDFカタログ(印刷最適化の`/@user/slug/catalog`=`CatalogDoc`+`catalog.css`の@media print、ダッシュボードに「Catalog (PDF)」導線。ライブラリ追加なし)。同梱Chromiumで画面/印刷2面を実描画検証(2作品・画像・sale tag・印刷時toolbar非表示)。tsc・build クリーン
- 2026-07-14: 戦略ロードマップ§7を実装。P0-2「AI学習に使わない」明文化(Terms/Privacy/LP)・P0-3マルチプレイ低優先度注記・P1-4 Stripe決済(Checkout+署名検証Webhook+冪等RPC `record_capacity_purchase`/migration 0019、未設定時フォールバック)・P1-6 embed(`?embed=1`+iframeコピーUI+認証ルートのframe拒否)。/code-review高で5指摘→CONFIRMED2件修正(キャパ購入の記録喪失を冪等RPCで解消/クリックジャッキング防止ヘッダー)。tsc・build・実挙動(501/401/400・embed HUD・frameヘッダー)検証済
- 2026-07-14: 競合を調査し docs/STRATEGY.md（競合分析・販売戦略・機能ギャップ・優先度順タスクリスト§7）を作成
- 2026-07-14: LPヒーローに右の3点目を追加（構図バランス）＋ LP表示作品を`/admin`から設定可能に（migration 0018 `site_config`：公開read/admin write）。中央/左/右3枠に画像アップロード→未設定はデモ作品にフォールバック、PC/モバイル共通。`HeroScene`は設定画像をテクスチャ描画（`FramedImage`）、`components/LpHeroEditor`で編集。tsc/build/描画（LP無リグレッション＋編集UIをスクショ）検証済み。※実画像の差し替え反映は実Supabaseでのみ最終確認可
- 2026-07-14: 管理画面 `/admin` を追加（migration 0017: `admins`表・`is_admin()`・管理者横断read・売上金額列）。総課金額・ユーザー別保有パッケージ・全展示空間（非公開含む）を表示。方式はDB adminsテーブル+RLS（既存SPA/anon+RLS構成に一致、クライアント自己昇格経路なし）。決済未接続のため総課金額は¥0だが、`purchases.amount_jpy`で集計基盤は用意。tsc/build/描画（モックでスクショ）検証済み。※RLSの管理者ゲート実挙動は実Supabaseでのみ最終確認可
- 2026-07-13: デモ→戻ると環境音が鳴り止まないバグを修正。`galleryAudio`（モジュールsingleton）にsuspend/resumeを追加し、`GalleryApp`アンマウントで停止（master gain即0＋`ctx.suspend()`）。動画音声側も`suspendVideoAudio`で対称化。Playwright+同梱Chromiumで離脱後`suspended`を実挙動検証
- 2026-07-13: リリース品質化。ランディング料金表を実モデル（無料5点+買い切り3軸+Video Pass年額）へ是正／オーナーが`/demo`を開いた時のHUDを自分の展覧会に切替＋デモ作品の混在を除外（派生状態で実装しサインアウト時の副作用を回避）／3D没入中のalert()を非ブロッキングtoastへ（`lib/toast.ts`）／"ten artists"→"ten works"。tsc・next build・全ルートのスモーク(200/404)確認済み
