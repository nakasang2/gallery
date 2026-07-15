# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-15（手動スロット配置 §11.18 を追加。既存ユーザーの work_cap を無料枠へ戻すSQLも案内済み）

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
- 2026-07-15: **手動スロット配置（§11.18・migration 0023）**。ユーザー相談「3点しか無いとき端から詰めず間隔を空けたい／狙った壁に作品を置けるか」に対し②手動配置を実装。`galleries.arrangement`(jsonb配列 `arrangement[slotIndex]=artworkId|null`)を追加、**未設定=従来通り0番から詰める**ので既存の部屋は無影響。純粋関数`lib/arrangement.placeWorks`(明示配置を尊重＋未割当の新作だけ空き枠へ前詰め)を`lib/exhibition.usePlacement`(=`{list,slots}`)経由で描画/ナビ層へ。`GalleryScene`/`WalkControls`/`MiniMap`を`layout.slots[i]`→`layout.slots[slots[i]]`に。公開は`rebuildPlacements`が`arrangement`に沿って`placements.slot_index`へ疎に書き(空き枠は行なし・不要枠トリム)、公開読込で`slot_index`から復元し来場者も同じ壁/空き枠を見る。編集UI`components/PlacementEditor`(ダッシュボードの俯瞰ルームマップ：枠タップ→作品割当/空に。1作品1枠)、テーマ/レイアウトと同じrow基準デバウンス保存でレース回避。検証: placeWorks/toPlacementをNodeで9ケース単体(空→従来動作・意図的空き維持・新作補充・重複/ghost無視・超過非表示/overflow・疎slot)、/demoをheadlessで従来動作無傷、PlacementEditorのSSRで5枠中3作品2空き＋初期ヒント確認。tsc・build クリーン。**未着手**: 3D空きゴースト非表示(ユーザー指定)・/demo内ドラッグ配置は将来
- 2026-07-15: **既存ユーザーの work_cap を無料枠(5)へ戻す方法を案内**（0013で既定10に据え置かれた既存部屋が原因）。作品を締め出さない安全版SQL `update public.galleries g set work_cap = greatest(5,(select count(*) from public.placements p where p.gallery_id=g.id)) where work_cap>5;`（全体/特定ユーザー版）。**これは1回限りのデータ補正でschema.sqlには入れない**（毎回流すと将来のキャパ購入を巻き戻すため）。新規は`createGallery`が5を明示書込で対処不要
- 2026-07-15: **admin から特定ユーザーへ有料商品を手動アンロック/剥奪**。`purchases`はクライアントinsert禁止のため、admin限定のsecurity-definer RPC `grant_entitlement`/`revoke_entitlement`(migration 0022、`is_admin()`ゲート、`sku='admin_grant'`・`amount_jpy=null`で売上に計上しない)。`lib/admin`に`grantEntitlement`/`revokeEntitlement`、AdminDashboardのUsers表に付与商品チップ(×で剥奪)+「Unlock for a user」(ユーザー×商品セレクト+Grant)。**商品リストはTHEMES/LAYOUTSを動的に読み有料分のみ列挙**するため、将来テーマ追加時も自動で選択肢に出る。既存のusePurchasedIds/getEntitlementsがそのまま解決に使うので付与即反映。admin一覧の説明文も現状(フリー枠ゲート後)に更新。schema.sqlを0022込みで再生成しPostgres 16で全文+二重実行しエラーゼロ確認。同梱Chromiumでチップ/×/セレクト/商品一覧(whitecube/corridorは無料で除外)を確認。tsc・build クリーン
- 2026-07-15: (a) **ダッシュボードのプレビューがDesign Toolsの色を反映しないバグを修正** — `Preview3D`/`WallPreview`が生の`THEMES[themeKey]`を使い上書きを無視していたのを`resolveTheme(theme, overrides)`経由にし、live `design`を渡す(同梱Chromiumで壁色が変わることを確認)。(b) **adminからデモのテーマを変更可能に** — `site_config` `demo_look`(migration不要・0018利用)、`/demo`が読み込みhydrate後に適用(guest限定・`GalleryApp` demoTheme prop、loadingDone後にupdateSettingsで上書き)、`/admin`に「Demo look」テーマチップ(`DemoLookEditor`)。同梱Chromiumで既定=chic(暗い正面壁)/whitecube指定=全面白 を確認
- 2026-07-15: **フリー枠のテーマ/レイアウトを whitecube / corridor のみに変更**（ユーザー指定）。`FOREVER_FREE_THEME_IDS=['whitecube']`・`FOREVER_FREE_LAYOUT_IDS=['corridor']`。chic/noir・hall/island/portrait/custom は有料化。連動対応: 新規ギャラリー既定を無料の`studio`テンプレ(whitecube/corridor)へ(`createGallery`。DB既定chic/hallに落ちないよう)、CreateCardの既定を`studio`に、有料テンプレ(salon/noir/tower)は🔒Premium表示+作成ブロック(`isTemplateUnlocked`=テーマ&レイアウト両方所有時のみ)。同梱Chromiumで検証: whitecube/corridor=解放・他=施錠・studioのみ無料テンプレ(towerはportraitが有料で施錠)。tsc・build クリーン。**未変更(要判断)**: `/demo`のDEFAULT_SETTINGSは chic/hall のまま(ショーケースの見た目維持)。既存galleriesがchic/hall使用中でもレンダリングは継続(再選択のみ要購入)
