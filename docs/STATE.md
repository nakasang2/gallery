# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-16（並行セッションの成果をrebaseで合流。“気配”ゴーストをリグ付きglTFキャラ化 §11.19.2 v0.57 ＋ レビュー指摘の技術的負債 B6/B7 を解消）

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
- 2026-07-16: **“気配”ゴーストをリグ付きglTFキャラに（§11.19.2 v0.57）**。別経路でmainに追加された`walk.glb`/`idle.glb`が各約200MB→中身の99%が誤同梱のKitBash3D「NeoCity」街並みで実キャラは約2MBのみと判明。`gltf-transform`で街シーン破棄+テクスチャ1024px WebP+Draco圧縮+1ファイル集約し**200MB→1.6MB**(`public/models/visitor.glb`、リグ65joint・walk1.07s/idle14.37sの2アニメ健在、LFS外の通常blobでコミット、Dracoデコーダ`public/draco/`ローカル同梱)。`GhostVisitors`のプリミティブ人体を差し替え——移動AIは流用、手続き歩行→walk/idleクロスフェード、多数インスタンスは`SkeletonUtils.clone`(scene.cloneはスケルトン切れでT字固まる)、**A案(気配)踏襲でテクスチャ無し・壁コントラスト着色の半透明シルエット**。QAで明壁=暗ゴースト/暗壁=淡ゴースト・歩行・スケール・透過を実シーン撮影確認。tsc・build クリーン。QA/最適化用devパッケージ削除済み。未着手: 元200MB原本は未参照(保全のため保留)・ポリ削減/複数モデル化は将来
- 2026-07-15: **Customレイアウトの調整UIをダッシュボードへ（§11.20）**＋作品ストリップの整理。ユーザー指摘「Customを選んでも編集できない」→ 幅/奥行き/中央壁のつまみが3D`SettingsPanel`にしか無かったのを、`app/me/page.tsx`のRoom行に「Custom size」ブロック（Width 16–36m/Depth 8–20mスライダー+Centre wallチェック）として追加。ローカルstate+デバウンス(500ms)で`saveGallerySpace`(+公開時`rebuildPlacements`)。既存グローバルCSS流用でCSS追加なし。**課金はユーザー判断で無料のまま**（Customチップの未ゲートは既知として保留）。あわせて作品ストリップを「空き枠は全部＋（アップロード可）＋末尾に別枠の課金タイル🔒+5」に整理し、意味不明だった◇を廃止。headless/SSRで描画確認。tsc・build クリーン
- 2026-07-15: **過去来場者の“気配”シルエット（§11.19・migration 0024）**。ユーザー提案「3Dなので他の人の気配を作りたい／過去の訪問数に応じて非同期で」。リアルタイム同時接続(=後回しのマルチプレイ)ではなく、**累計訪問数に比例した半透明シルエットが会場を徘徊**する非同期プレゼンス。人数は `lib/ghosts.ghostCountForVisits`(対数写像・`MAX_GHOSTS=4`でキャップ・<3訪問は0)。訪問数は `visits` がオーナー限定SELECTなので**集計だけ返すSECURITY DEFINER RPC `public_visit_count`**(migration 0024・公開箱庭のみ・個票なし)を追加し `PublicExhibition.visitCount` へ。描画は `components/gallery/GhostVisitors`(canvas生成のビルボード人型スプライト・壁明度で色反転・距離フェード・作品前で滞在)。**公開ページ専用**でオーナー/`/demo`には出さない・**フォーカス中は非表示**・`LOW_POWER`オフ。環境ざわめきを `lib/audio.setCrowdLevel`(声域ノイズ・ゴースト数比例・無人=無音・mute/離脱ゲート踏襲)。検証: 数写像をNode12ケース単体、headless(swiftshader)で会場に人影が並ぶのを確認。tsc・build クリーン。**追補(v0.55)**: ユーザー要望「もう少しリアルに・歩いたりポーズしたり」で初版のビルボード平面を廃止し、**プリミティブのローポリ人体＋手続き歩行(脚を互い違いにsinで振る・進行方向/作品を向く)**に差し替え、実体化(opacity≈0.85＋足元接地シャドウ)。アセット追加なし。QA至近撮影で頭/胴/腕/脚・歩行・移動を確認。将来はリグ付きglTFに差し替え可能な構造。未着手: 人気作(いいね)にゴーストが集まる演出、B案リアルタイム
- 2026-07-15: **手動スロット配置（§11.18・migration 0023）**。ユーザー相談「3点しか無いとき端から詰めず間隔を空けたい／狙った壁に作品を置けるか」に対し②手動配置を実装。`galleries.arrangement`(jsonb配列 `arrangement[slotIndex]=artworkId|null`)を追加、**未設定=従来通り0番から詰める**ので既存の部屋は無影響。純粋関数`lib/arrangement.placeWorks`(明示配置を尊重＋未割当の新作だけ空き枠へ前詰め)を`lib/exhibition.usePlacement`(=`{list,slots}`)経由で描画/ナビ層へ。`GalleryScene`/`WalkControls`/`MiniMap`を`layout.slots[i]`→`layout.slots[slots[i]]`に。公開は`rebuildPlacements`が`arrangement`に沿って`placements.slot_index`へ疎に書き(空き枠は行なし・不要枠トリム)、公開読込で`slot_index`から復元し来場者も同じ壁/空き枠を見る。編集UI`components/PlacementEditor`(ダッシュボードの俯瞰ルームマップ：枠タップ→作品割当/空に。1作品1枠)、テーマ/レイアウトと同じrow基準デバウンス保存でレース回避。検証: placeWorks/toPlacementをNodeで9ケース単体(空→従来動作・意図的空き維持・新作補充・重複/ghost無視・超過非表示/overflow・疎slot)、/demoをheadlessで従来動作無傷、PlacementEditorのSSRで5枠中3作品2空き＋初期ヒント確認。tsc・build クリーン。**未着手**: 3D空きゴースト非表示(ユーザー指定)・/demo内ドラッグ配置は将来
- 2026-07-14〜15: **並行セッションでの合流分**（本セッション側）: 管理画面`/admin`追加（migration 0017: `admins`表・`is_admin()`・管理者横断read・売上金額列）／LPヒーロー3枠を`/admin`から設定可能に（migration 0018 `site_config`）／デモ→戻ると環境音が鳴り止まないバグを修正／ランディング料金表を実モデルへ是正／3D没入中のalert()を非ブロッキングtoastへ／レビュー指摘のB6(LP画像の孤児ファイル)・B7(admin集計の1000行上限)を解消(`fetchAll`によるページング化・スロット固定パスのupsert化)。origin/mainへrebaseして合流（コンフリクトはSTATE.mdのみ、コード側は無衝突）。tsc・build クリーン

