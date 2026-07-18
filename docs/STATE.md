# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-17（テーマprevを空間モード(人無し・引き画)化 / アート節を全幅ストリップ+2カラムに / 音声アップUI削除 §11.25）

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
- 2026-07-17: **テーマprev空間モード化/アート節を全幅ストリップ+2カラム/音声UI削除（§11.25）**。§11.24の2セクションを見たユーザー3点: ①テーマ3Dviewはアートと同じで微妙、人モデル無し・展示場の雰囲気重視に ②アートは全幅横並び→その下に2カラム(左3Dview/右設定) ③音声アップロードUI不要(読み上げ有)。対処: ①`Preview3D`に`mode='work'|'room'`追加、roomは`ScaleFigure`を描かずカメラを引いて壁/床/スポット光溜まりを見せる(Rig room分岐)、テーマ節は`mode="room"` ②`.art-section`直下に全幅`.works-in-room`カルーセル→`{selected&&}`で`.works-detail`2カラム(preview/設定) ③`.wd-audio`ブロック+`setWorkAudio`+`uploadArtworkAudio` import+CSS撤去(既存audio_urlは`saveWorkDetails`が渡さない&`updateArtworkDetails`はundefined時未更新なので温存)。軽量QAでroom/work比較+全幅ストリップ2カラムをスクショ確認・削除済み。tsc・build クリーン
- 2026-07-17: **設定画面を2セクションに分離＋簡素化（§11.24）**。ユーザー要望3点: ①価格タグはロックのみ ②Design Tools非表示 ③テーマ選択とアート設定をセクション分離。対処: ①`.chip-price-tag`の価格テキストを削除し`.chip-lock-only`で丸型ロックバッジに(me/page+SettingsPanel計4箇所、PRICE_SINGLE_ITEM import削除) ②`DESIGN_TOOLS_VISIBLE=false as boolean`ゲートで非表示・コードは残置(1行で復帰) ③`we-right`一本を廃し**works-detailグリッド2つを縦積み**: §1「Theme & layout」[3D room preview | テーマ+レイアウト]、§2「Works in this room」[3D 作品preview | カルーセル+作品設定+Save]、区切りは`.works-detail--art`のborder。§1 previewはカバー作品+部屋デフォルト額装(roomArt)、§2は選択作品(previewArt)。両preview描画は`GalleryPreview`ヘルパへ共通化(`/code-review`指摘)。既知: 3Dプレビュー2枚同時(demand-frameloopでアイドル)。軽量QAでスクショ確認・削除済み。tsc・build クリーン
- 2026-07-17: **ギャラリー設定画面を Room ⊃ 作品 の入れ子に再構成（§11.23）**。ユーザー「一番気になってるのはギャラリーの設定画面」。**まずスコープ切替(Room/This work)案を出したが「50点・微妙」で不採用** — 指摘は情報設計の粒度: 「Roomの中に作品がある」のに、作品カルーセルが上・Room/This-workトグルが下で子が親より上に来て入れ子が破綻。トグルは別の抽象を持ち込んだだけ。→ 採用案は`we-right`を上から **The room(Theme/Layout/Custom/Placement) → Design Tools → Works in this room(カルーセルをここへ移設・枚数表示) → Editing "◯◯"(選択作品のプレート/サイズ/額装/Save)** の一本フローに。左の固定3Dプレビューが部屋変更も作品変更も同時反映。上部にあった全幅ストリップ+works-headは廃し③へ集約。空状態は③内upload-hero。全アプリ`.btn-line`に押下/フォーカスリング/hover背景も追加。軽量QAで親⊃子の並びをスクショ確認・削除済み、`/code-review`(未到達な空状態note削除)。tsc・build クリーン
- 2026-07-17: **絵文字アイコンをSVGアイコンに置換（§11.22）**。「絵文字アイコン使用している箇所は全て普通のsvgアイコンに変更してください」。全`.tsx`/`.ts`走査で真の絵文字は🔒(ロック)と🎬(動画)の2種・計10箇所のみと特定(×/✓/⇄/★☆/♥♡/▶■/♪等はUnicode記号であって絵文字ではないため対象外と判断)。`components/icons.tsx`(新規)に`LockIcon`/`VideoIcon`を追加(`SnsLinks.tsx`と同じ規約: `viewBox 24x24`・`1em`・`currentColor`)、`SettingsPanel.tsx`/`SpacePreviews.tsx`/`PlacementEditor.tsx`/`app/me/page.tsx`の該当箇所を置換。アイコン+テキストの並びが必要なコンテナには`display:inline-flex; gap`を付与。QAルートで全アイコンの見た目を確認・削除済み、grepで絵文字の残存なし(説明コメント内のみ)。tsc・build クリーン
- 2026-07-17: **作品の実寸・画材と3D比率反映（§11.21）**。「各絵に縦横・mediumを入れたい／入力寸法と空間上の比率を合わせたい」。`artSize(ratio,dims?)`が実寸(w,h cm)両方あればアスペクト=w:h・高さ=h/100mを採用([0.4,2.4]m/幅≤2.6mクランプ)、呼び出し3箇所を更新。DB: migration 0025で`artworks`に`width_cm`/`height_cm`/`medium`、`updateArtworkDetails`はグレースフルデグレード。入力UIはプリセット選択(号F/A判/B判・`lib/artSizes`)＋W×H手入力＋向き入替、`app/me`は入力中値を`previewArt`でPreview3Dへ渡し**保存前に即時反映**。**§11.21.4**: ダッシュボードのスケール基準人型をcanvas簡易シルエットから**ゴースト来場者と同じ実glTFモデル`visitor.glb`**に置換(深度プリパスのフラット半透明シルエット・3/4ビュー、idleクリップを`mixer.setTime`で固定ポーズ、実寸出力なのでスケール補正なし)。単一canvasでF0/A2/A0/F100を個別QAし相対サイズを確認・削除済み。tsc・build クリーン。**運用前提**: 実ギャラリー反映には本番DBへ0025適用＋「Save plate」保存が必要。**追補(§11.21.5)**: ユーザー指摘「壁にめり込んでる」→ 正面固定カメラでは奥行きの視差が出ず、壁からの距離0.1mでは足元が壁際の境界線と重なって見える(top-down正投影で実際の物理貫通は無いことを確認済み、純粋に視覚的な問題)。壁クリアランスを0.55mに拡大＋接地シャドウ追加＋`Rig`のカメラ距離計算を作品/人物それぞれの奥行きから個別投影する厳密な方式に修正(距離を伸ばす方向は常に安全なので両者ともフレーム内に収まることを保証)。**追補(§11.21.6)**: ユーザー指摘「cm ⇄が改行される」→ Size入力行のW/×/H/cm/⇄を`flexWrap:'nowrap'`の内側divでグループ化し、折り返しがグループ単位で起こるよう修正。**追補(§11.21.7)**: ユーザー指摘2点(スクショ付き)「① 作品ストリップの追加UIが枠線のみで塗り済みセルと高さが揃わない ② Save platesの位置が中途半端で押しそびれそう」。①`.works-add`/`.works-capacity`を塗り済みセルと同じ「枠(box)+外側キャプション」構成に再構築(box=`.works-add-box`/`.works-capacity-box`、キャプション=「Slot N」/「more slots」)し行の高さを統一。②「Save plate」ボタンをパネル最下部(`WorkDesign`の後)へ移動し、全幅金グラデーションCTA`.wd-save-cta`として"Save settings"に改称・格上げ(frame/mat/hanging等は選択即自動保存、テキスト系のみ明示保存が必要という区別は維持)。軽量QAルートで高さ揃い・CTA有効/無効表示を確認・削除済み。tsc・build クリーン

