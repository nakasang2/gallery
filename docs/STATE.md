# STATE.md — 作業状態（セッション横断）

> Claude向け運用ルール: セッション開始時にこのファイルを読んでから作業に入る。作業の節目・中断時・ship後に更新する。終わった項目は「完了ログ」へ移し、完了ログは直近5件だけ残す。

- **最終更新**: 2026-07-27（削除時のCDNキャッシュパージをship・本番反映確認済み。実効のE2E確認だけ残り）

## 進行中
- **削除時のCDNキャッシュパージの実効確認**（DECISIONS 2026-07-27参照）。コードは本番反映済み、Cloudflareトークン(`CLOUDFLARE_ZONE_ID`/`CLOUDFLARE_PURGE_TOKEN`)もVercel設定済み。**残るは実際に効いているかのE2E確認だけ** — R2_SETUP §7.5の手順で、捨ててよいテスト作品を1枚上げる→URLをエッジに載せる(`cf-cache-status: HIT`)→削除→同じURLが404になるか。効いていなければVercelログに `cache purge rejected` が出るので、§7.5の切り分け（トークン権限 / プレフィックス指定が拒否されるならURL指定へ切替）に従う。
- **Stripe決済の本番有効化**（DECISIONS 2026-07-24参照、本番モード＋Xibit360専用の新規アカウントで確定）。Claude済: `NEXT_PUBLIC_SITE_URL=https://www.xibit360.art`設定。ユーザー待ち: ⓪同じログイン下にXibit360専用アカウントを新規作成し本番有効化 ①`0019_checkout.sql`をSupabase SQL Editor適用 ②新アカウント(live)の`STRIPE_SECRET_KEY`(sk_live_)をVercelに ③新アカウントでWebhook作成(`https://www.xibit360.art/api/stripe/webhook`・`checkout.session.completed`)→`STRIPE_WEBHOOK_SECRET`(whsec_)をVercelに ④価格USD化に伴い`0028_capacity_clamp.sql`もSQL Editorで適用。完了後Claudeが再デプロイ＋疎通検証(checkout=401/webhook=400)、実カードで**スロット追加($3〜)購入→返金**でE2E確認（USD化で¥580→$3/枚に変更済み）。

## 次にやること（再開ポイント）
- **描画品質ティアの実機QA**: low/mediumティア（スマホ）はローカルでポインタエミュ不可のため未検証。本番反映後、実スマホで①普通のスマホ=影あり(1024)・反射なし ②古い/安いスマホ=影なし＋疑似影のみ、のフレームレートと見た目を確認（DECISIONS 2026-07-23参照）
- **読み上げTTS**: 本番ENV(`OPENAI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY`)設定済み。`/api/tts`は本番で200・mp3公開再生可・キャッシュ動作を確認済み。ボイスは**shimmer確定**。残: アプリ実画面での再生体験（ツアー▶/作品ガイド）＆日本語キャプションでの発音は本番QAで最終確認。
- **Stripe本番接続の運用作業**（コードは完成・未接続）: `0019_checkout.sql`適用 → `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SITE_URL` 設定 → Stripe CLIで実カード確認（手順は supabase/README §5）
- **画像/動画ストレージのR2移行**: **ship完了・本番反映済み（2026-07-27）**。残: ユーザーによる本番の実機QA（サインイン→作品表示・新規アップロード・動画アップロード・削除・読み上げ・容量上限）。それが通ったら **Supabase Storageの`artworks`バケットを空にする**（数日様子見してから。ロールバック用にまだ残してある）。
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
- 2026-07-27: **【ship済・本番反映確認】作品/アカウント削除時にCloudflareのCDNキャッシュをパージ**（3コミット、DECISIONS 2026-07-27参照）。R2から実体を消してもエッジのコピーが最大4時間配信され続け、URLを知っている人はダウンロードできる状態だった（R2が全オブジェクトに`cache-control: max-age=14400`を付けて返すのが原因。本番の`cdn.xibit360.art`で200/404とも実測して確定）。`app/privacy`の「削除したらファイルも消える」に実態が追いついていなかった。**URL指定でなくプレフィックス指定のパージ**を採用 — 削除したキー一覧が不要で1回の呼び出しで作品フォルダ全体を消せ、クエリ文字列を問わずマッチするので`?v=`付きURL（アバター/ロゴ/BGM）にも届く。調査の結果、以前は上位プラン限定だったプレフィックス指定が**無料プランでも使える**ようになっていた。順序はR2から消した後（先だと隙間のアクセスで再キャッシュされる）、失敗しても削除は成功扱い（ベストエフォート）、実体0件のときは呼ばない（存在しないIDの連打でアカウント共有のパージ上限を消費されるのを防ぐ）。ゾーン権限の新規トークンをユーザーが発行し`CLOUDFLARE_ZONE_ID`/`CLOUDFLARE_PURGE_TOKEN`をVercelに設定済み（Vercel CLIで変数名を確認）。検証: tsc/build通過、本番で`/` `/explore` `/me` `/demo` 200・`/api/storage/delete` 401（501でない）。**残: パージが実際に効いているかのE2E確認**（テスト作品を上げて削除→URLが404になるか）。手順とフォールバックは R2_SETUP §7.5。
- 2026-07-27: **【ship済・本番反映確認】未使用だった作品音声ガイドのアップロード経路を削除**（2コミット、cleanup のみ）。サーバー側TTS化(5f7aade)でUIが消えた後も残っていた書き込み側（`uploadArtworkAudio`／`/api/upload-url`の`artwork-audio`ルール／`lib/limits.ts`の`AUDIO_GUIDE_MAX_BYTES`／`updateArtworkDetails`の`audioUrl`）を撤去。R2移行がこの死んだ関数をそのまま移植していたため死角が増えていた（LESSONS 2026-07-27）。**読み取り側は温存**: `artworks.audio_url`と`lib/guide.ts`/`ArtworkPanel`の再生経路はそのままなので、既にURLが入っている作品は引き続きアップロード音声を優先再生する（`0029_r2_urls.sql`が同列をR2 URLへ書き換え済み）。tsc/buildクリーン、本番で `/` `/demo` `/me` `/explore` 200・`/api/upload-url` 401 を確認。
- 2026-07-27: **【ship済・本番反映確認】ファイル置き場をSupabase Storage→Cloudflare R2へ移行**（3コミット、DECISIONS 2026-07-27参照）。狙いはegress費のゼロ化（STRATEGY §2.3のCara事例）。認証とDBはSupabaseに残す。アップロードは`/api/upload-url`が署名した一時URLへブラウザから直PUT（Vercelの4.5MB上限を回避し40MB動画も通る）。旧RLSポリシーが担保していた「自分のフォルダしか書けない」はサーバーがJWTのuidからパスを組む方式に置換、容量上限もブラウザ側の助言的チェックからサーバー強制へ。DNSはムームードメイン→Cloudflareへ移管（ダウンタイムなし）、配信は`cdn.xibit360.art`。既存18ファイル(1.8MB)を移送、`0029_r2_urls.sql`で絶対URL列を書き換え（実際に該当したのは`profiles.avatar_url`1件）。**別視点レビュー3本で計10件超を検出・修正** — 出荷を止めた級が4件: ①R2バケットのCORS未設定（3D展示は`crossOrigin`で画像を読むため無いと作品が1枚も出ない）②AWS SDKが空ボディのCRC32を署名クエリに埋め込み全PUTが失敗する問題（`requestChecksumCalculation:'WHEN_REQUIRED'`で回避・署名URLを実生成して確認）③`ownsRow`がRLSの可視性を所有と誤認（公開ギャラリーIDで他人のIDを通せた）→`owner_id`突き合わせに修正 ④`0029`の`alter table ... disable trigger`が権限不足で落ち、SQL Editorの単一トランザクションによりDML全体がロールバック（実際に発生）→ALTER TABLE撤去。検証: tsc/build通過、Preview・本番で`/api/upload-url`が401（501でない＝環境変数OK）、`/api/tts`が`cdn.xibit360.art`のURLを`cached:true`で返す、実ファイル5件の配信＋CORSヘッダを実測確認。**出荷後にユーザー報告で1件退行を検出・修正済み**: 3D展示が空の額縁になる（2Dサムネイルは正常）→ R2はOriginなしのリクエストにCORSヘッダも`Vary: Origin`も返さないため、`crossOrigin`なしの`<img>`が先にキャッシュしたCORSヘッダ無し応答を、後続のWebGLテクスチャ要求が再利用して失敗していた。全16箇所の`<img>`に`crossOrigin="anonymous"`を付与し、実ブラウザで前後を再現検証（LESSONS 2026-07-27）。**残: ユーザーの実機QA（スーパーリロードしてから）とSupabase Storageバケットの空化**。
- 2026-07-24: **【ship済・本番反映確認】価格モデルの作り替え（USD化・スロット従量制・Design Tools無料化・全レイアウト15枠）**（6コミット、DECISIONS 2026-07-24参照）。全価格をUSDセント整数へ、スロットは$3/枚の数量ピッカー（1部屋最大15枚）、テーマ$8/レイアウト$5、Design Toolsは全員無料（販売撤去）、hall/corridor/island/portraitを各15スロットに統一。並行購入でwork_capが15超過し得る穴を migration 0028（RPCで`least(...,15)`）で封鎖。ゴースト円形影削除・Theme Collection撤去も同梱。tsc/build/別視点レビュー通過、/demoで4レイアウト実機確認、www.xibit360.art の料金表に$3/$5/$8/$0反映を確認。**残: Stripe鍵設定＋SQL 0019/0028 適用（ユーザー作業）で実際の課金が有効化**。
- 2026-07-24: **【ship済・本番反映確認】作品鑑賞UI一式＋ピクチャーライト修正**（7コミット、DECISIONS 2026-07-24参照）。①overheadピクチャーライトを仮想光源方式に再設計（白飛び/光幅/影を一括解決）②`‹ ›`ステッパーを作品フォーカス中は隠しPrev/Nextをパネル内へ移設③作品クリックの鑑賞は「View in 3D」ボタン→**額縁ごと拡大・回転できる全画面3Dプレビュー**（新規`ArtworkPreview3D.tsx`＝遅延ロード専用Canvas＋drei OrbitControls、`Exhibit`の`makeFrameGeo`再利用、開幕は引き→正面のドリーイン`IntroDolly`、reduced-motion配慮）。当初の2D図版案は「3Dと二重」で撤去。ship前レビューで3件（動画posterリーク/poster無しfallback/frameGeo churn）を修正。tsc・next buildクリーン、www.xibit360.art/demo 200確認。
