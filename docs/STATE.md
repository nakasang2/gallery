# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-22（/me Galleryタブを左サブメニュー方式に再構成）

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
- 2026-07-22: **/me Galleryタブを左サブメニュー方式に再構成**（DECISIONS 2026-07-22参照）。項目過多の解消。`app/me/page.tsx` の `GalleryCard`: 単一長カード→「識別ヘッダーカード＋枠外レール(`.me-gallery-body`／`.me-subnav`)＋内容カード(`.me-subcard`)」に。`selectedId` を `nav:'room'|workId` へ置換、作品削除時のroomフォールバック effect追加。作品サムネ横ストリップ(`works-strip`/`art-section`)廃止→レールが作品一覧を兼ねる(Room＋作品1点ずつ＋Add work＋+5 slots)。見た目(額縁/掛け方等)は作品パネルに同居のまま(標準スタイル集約はせず)。cover/removeは作品パネル内`.work-actions`へ移設。公開/URL/埋め込み/カタログ/削除は現状ヘッダー維持。保存も現状維持(Saveは選択作品単位・room表示時は非表示)。レスポンシブ: PC縦レール/≤720px横スクロール。me.cssに`.me-gallery-body`他を追加。tsc・buildクリーン、一時ハーネス(`/me-harness`・削除済)でPC縦/モバイル横/作品⇄部屋切替/Save出し分けを目視確認。※本体は認証必須(ローカルはSupabase未設定で描画不可)のため、実データでの3Dプレビュー/アップロード/保存往復は本番QA。
- 2026-07-22: **ライト位置選択＋壁グライド足音抑制**。ユーザー指示2点。①各作品スポットの位置を選択可に: `design_overrides.lightMode`('ceiling'|'overhead'、マイグレ不要)追加。Exhibitの`lightPos`を切替(ceiling=壁法線2.1mのトラック照明・既定/overhead=作品真上0.45mから真下へ)。ダッシュボードTheme節に「Lighting: Ceiling/Above work」チップ追加、GalleryScene・Preview3Dへ伝播、影焼き直しの依存に`designOverrides`追加。②壁情報へ寄る時の高速足音: `focusWall`は`targetIndex=-1`で従来の足音抑制条件を外れ鳴っていた→`state.autoGlide`フラグを追加しfootstepガードに反映(focusExhibitと同様に抑制)。`/demo`でライト移動を確認、tsc・buildクリーン。※Lighting UIは認証必須/me実描画は本番QA。**追記(同日ユーザーFB)**: 「作品真上」は天井光でなく“作品上の壁から出っ張るピクチャーライト”が正解→overheadを壁付きピクチャーライト(フレーム上0.22m/壁法線0.34m先、angle0.85)に作り直し。フィックスチャーも真鍮バックプレート＋アーム＋横チューブシェード＋丸エンドキャップ＋暖色発光ラインへ本格化。ceilingは天井トラック(2.1m/作品中心/0.46)に戻し。`/demo`で造形確認。
- 2026-07-22: **3D Gallery 仕上げ4点**。ユーザー指示。①タイトル壁クリックで作品同様にカメラを壁正面へグライド(`WalkAPI.focusWall`追加)＋情報パネル。②壁テキストを中央縦積みに簡略化(展示名→アイコン→名前→@account。eyebrow/subtitle/statement/bio・2カラム・未使用wrapNote/mutedを撤去。statement/bioは情報パネル側)。③ガイドツアー▶をページャー横から右下クラスタのbase先頭へ移動(ページャーは‹›のみ)。④Others展開中(hover/open)はアイコン⋯→✕(デュアルグリフCSS)、SHAREを↗→紙ヒコーキ(送信)SVG`SendIcon`(HudAction.iconをReactNode化)。`/demo`＋静的ハーネスで検証、tsc・buildクリーン。※プレビュークリック座標系は691×784(CSS)。
- 2026-07-22: **3D Gallery UI追い込み3点**。ユーザー指示。①Others展開中は base アクション(BGM/Share/Guestbook)を隠しサブメニューのみ表示(`.hud-base`+`.others-open`／`:has(.hud-others:hover)`)。②タイトル壁をクリック可能にし作品同様の詳細パネル`InfoPanel`(Exhibition/タイトル/statement/作家bio)を開く。store に `infoOpen`/`setInfoOpen` 追加(他ドロワーと排他)、GalleryAppで描画、HUD/ステッパー/ヒントは infoOpen 時も tuck。③壁 hover でカーソル pointer(作品と同一 onOver/onOut。作品側は既存対応)。`/demo`実機で3点とも確認(infoOpen発火・base非表示)。tsc・buildクリーン。※プレビュークリックの座標系は 691×784(CSS)で、デバイスpxではない点に注意(検証時ハマった)。
- 2026-07-22: **3D Gallery HUDの刷新**。ユーザー指示。①左上テキストをサービス名(XIBIT360)＋展示名＋展示者のみに（@ユーザー名/SNS/Explore/Report撤去）。②右下に統一アクションクラスタ新設(左下のRecordも統合): BGM/SHARE/GUESTBOOK/OTHERS(→REPORT/RECORD)。既定はアイコン+丸、hover/focusでラベル付きカプセルに拡張(`@media (hover:hover)`でタッチは丸のままタップ即実行)、OTHERSはhover/タップで上にサブメニュー。③SHARE新規: `navigator.share`対応時はOS共有シート、非対応時は公開URLコピー+トースト。④`RecordButton`を`useWalkRecorder`フック化しクラスタから駆動(GalleryApp単独描画を廃止)。モード差: visitor=全部、demo/owner=該当分のみ。tsc・buildクリーン、静的ハーネス＋/demoでコンソールエラー無しを確認。※visitor実画面(全ボタン/実共有・録画・記帳)は認証・実データ・3D要のため本番QA。

