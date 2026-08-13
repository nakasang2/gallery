# Supabase セットアップ手順

プロジェクト: `ncffdcvsksiutsjerpeb`(URL・キーは `.env.example` 参照)

## 1. スキーマの適用(必須・1回だけ)

### かんたん(推奨): 一発適用

**`supabase/schema.sql` 1ファイルを丸ごと貼り付けて Run** すれば、下の 0001〜0060 が
一括で適用されます(再実行しても安全)。個別に順番を追う必要はありません。

**未適用ぶんだけを1枚に束ねたいとき**は `npm run sql:pending -- <開始番号>`
(例: `npm run sql:pending -- 0036 --out pending.sql`)。固定ファイルを置くと次の
migration を足した日に古くなるので、必要なときに生成する。

Postgres 16.14 で検証済み(2026-07-29、0034まで / 2026-08-09 に 0042 まで再検証):

- 空のDBへ全文実行 → エラーゼロ。続けて2回目・3回目を実行してもエラーゼロ(冪等)
- **`schema.sql` で作ったDBと、`migrations/` を0001から順に個別適用したDBの
  スキーマが完全一致**(`pg_dump --schema-only` の差分ゼロ)。つまりどちらの経路でも
  同じDBができる
- 行が入っているDBに再実行してもデータは失われない(各表1行を入れて確認)
- **2026-08-09 追加**: 「0001〜0035 を適用して既存データを入れたDB」に 0036〜0042 を
  **3回**流してエラーゼロ・`profiles` の列が `expo_slug` のみで安定・既存の
  galleries/placements/guestbook/likes/purchases が全部残ることを確認。さらに
  `pg_dump --schema-only` で **schema.sql 1枚で作ったDBと完全一致**。適用後に
  未ログイン(anon)で公開ギャラリー閲覧・いいね・記帳・訪問記録が通り、いいねと記帳で
  通知行が生まれることも確認(0041 の権限事故の回帰)

検証はSupabase固有の前提(`auth.users` / `auth.uid()` / `storage.*` / anon・
authenticated・service_role の3ロール)を最小限スタブした素のPostgresで行った。
確認したのは構文・実行順序・冪等性・制約と関数の張り替え。**実際のJWTでRLSがどう
効くか、Storageの実挙動は範囲外**。

### 個別(履歴・差分を追いたい場合)

1. [SQL Editor](https://supabase.com/dashboard/project/ncffdcvsksiutsjerpeb/sql/new) を開く
2. `supabase/migrations/` のSQLを**番号順に**全文貼り付けて **Run**
   - `0001_init.sql` — テーブル・RLS・ストレージ(適用済み)
   - `0002_video.sql` — 動画作品対応(kindカラム追加)
   - `0003_order_profile.sql` — 配置の並び順(sort_orderカラム追加)
   - `0004_hanging_caption.sql` — 吊し方・キャプション設定
   - `0005_dashboard.sql` — ギャラリー更新日時(ダッシュボード用)
   - `0006_storage_bytes.sql` — 作品ごとの保存容量(300MB上限の実測用)
   - `0007_delete_account.sql` — アカウント削除RPC(本人限定・cascade削除)
   - `0008_engagement.sql` — 訪問記録・芳名帳・いいね(来場者エンゲージメント)
   - `0009_space_extras.sql` — カスタムレイアウトのパラメータ・OGP代表作の指定
   - `0010_reports.sql` — 通報のDB受付(閲覧はSQL Editor / service role / 管理画面で)
   - `0011`〜`0015` — 作品別上書き・マット・キャパ・Design Tools・購入リンク
   - `0016_purchases.sql` — 購入台帳(entitlementsの読み取り元。書き込みは将来のStripe webhookのみ)
   - `0017_admin.sql` — 管理者ロール(`admins`表・`is_admin()`)+ 管理者の横断read + 売上金額列
   - `0018_site_config.sql` — サイト設定(公開read/admin write)。LPヒーロー表示作品の管理画面設定に使用
   - `0019_checkout.sql` — Stripe決済対応(purchases.kind拡張 + キャパ加算RPC。RPCはservice roleのみ実行可)
   - `0020_articles.sql` — 記事/ガイド(公開read/admin write RLS)。`/articles`と`/admin`の記事エディタが使用
   - `0021_artwork_audio.sql` — 作品ごと音声ガイド(`artworks.audio_url`。鑑賞パネルの再生ボタン・ツアー自動再生)
   - `0022_admin_grant.sql` — admin手動アンロック(`grant_entitlement`/`revoke_entitlement` RPC。admin限定・`/admin`のUsersから付与/剥奪)
   - `0023_arrangement.sql` — 手動スロット配置(`galleries.arrangement` jsonb。作品をどの壁枠に飾るか・空き枠を残すか。未設定は0番から詰める従来動作)
   - `0024_public_visit_count.sql` — 公開ギャラリーの累計訪問数を anon に返す集計専用RPC(`public_visit_count`。過去来場者の“気配”シルエット表示に使用。個票は返さない・非公開は0)
   - `0025_artwork_dimensions.sql` — 作品の実寸と技法(`width_cm`/`height_cm`/`medium`。ラベル表示と3D空間での実寸スケール)
   - `0026_artwork_price.sql` — 作品の表示価格(`artworks.price`。作家が打った自由文。決済はXibit360を通らない)
   - `0027_gallery_bgm.sql` — 空間BGM(`galleries.bgm_url`。1曲をループ再生。未設定なら生成音のみ)
   - `0028_capacity_clamp.sql` — キャパ購入を物理上限15枠でクランプ(`record_capacity_purchase` を置き換え。同時決済で上限を超えるのを防ぐ)
   - `0029_r2_urls.sql` — 保存済みURLを Cloudflare R2 に向け直す**データ移行**(スキーマ変更なし。新規環境では0行で空振り。既存データがある環境では**ファイル移送後に**実行)
   - `0030_storage_reservations.sql` — 署名済みアップロードの予約台帳(`storage_reservations` + `reserve_storage` RPC。容量制限をR2の実測値ベースにする)
   - `0031_purchase_currency.sql` — 購入通貨の記録(`purchases.currency`。`record_capacity_purchase` を6引数版に置き換え。0019/0028の5引数版は削除される)
   - `0032_artwork_card.sql` — 一覧用の中間サイズ(`artworks.has_card`。card.jpg=長辺800があるかの旗。falseならdisplay.jpgにフォールバック)
   - `0033_moderation.sql` — 通報の対応状態(`reports.status`/`handled_at`/`handled_note`)+ 管理者による非公開化RPC(`admin_set_gallery_public`)+ 芳名帳のON/OFF(`galleries.guestbook_enabled`。0008のinsertポリシーを置き換え)
   - `0034_frame_purchases.sql` — 額(フレーム)を販売可能にする(`purchases_kind_check` に `frame` を追加 + `grant_entitlement` を置き換え。既存の額は無料のまま)
   - `0035_light_override.sql` — 作品ごとの照明モード(`placements.light_override`。NULL=部屋の既定に従う)
   - `0036_main_room.sql` — 複数展示室(`galleries.is_main` + 所有者ごとの部分ユニーク索引 + 切替RPC `set_main_room`。既存は所有者ごと最古の1室をバックフィル)＋**部屋数と初期キャパをDBで強制**するトリガ2本(`enforce_room_allowance` / `guard_work_cap_raise`。insertはRLS経由でブラウザから直接来るので、購入台帳を数えないと無料で部屋が増やせる)
   - `0037_placement_consent.sql` — **他人の作品の無断掲載を塞ぐ**(`room_invites` 表＋`may_place_artwork()`＋`placements_owner_all` の置き換え＋受諾取り下げで壁から外すトリガ。0001 は作品の所有者を見ておらず、公開作品のidは公開ペイロードに載るため無断掲載が可能だった。合同展示の土台も兼ねる)
   - `0038_room_grade.sql` — **無料枠のロンダリングを塞ぐ**(`galleries.slots_included`＝その部屋のキャパが部屋購入に含まれて来たか。部屋数を作成順ではなく等級で数える `enforce_room_allowance` に差し替え＋等級を後から書き換えられない `guard_room_grade`。0036 は作成順で推定していたため、無料部屋を消して作り直すと15枠になった)
   - `0039_expo_subdomain.sql` — 展示ごとのサブドメイン(`profiles.subdomain`)。**0040 でパス方式に切り替えたので、列も関数もそこで改名される**。0040 と続けて流せばよい
   - `0040_expo_slug.sql` — 展示のURLを `/expo/{slug}` に(`profiles.subdomain` → `expo_slug` へ改名、制約・索引・RPC・トリガも `set_expo_slug`/`guard_expo_slug` に。0039 を飛ばしていても番号順に流せば同じ結果になる)
   - `0041_room_submissions.sql` — **合同展示の招待を成立させる**(`room_submissions` 表＝作家が出す作品を選ぶ＋主催者が提出作品だけを読める `artworks_select_submitted_to_my_room`＋`may_place_artwork` を「受諾済み招待**かつ**提出済み」に締める＋取り下げで壁から下りるトリガ＋`invite_artist_by_handle` RPC。0037 は招待の表を作っただけで、**主催者が招待した作家の作品を見る経路が無く**UIが作れなかった。述語はすべて `security definer` の関数に出す＝ポリシー内に直接書くと `room_submissions` ⇄ `artworks` で**RLSが無限再帰する**)
   - `0042_notifications.sql` — **通知**(`notifications` 表＋トリガ5本＋管理者の一斉送信 RPC)。行を書くのは definer のトリガと RPC だけで **insert ポリシーを1つも作らない**（許すと他人宛に偽の通知を作れる）。いいねは作品ごと1日1件にまとめ、部屋名・作品名は書いた時点の値を焼き込む（source を消しても読める）。**冒頭で 0041 の権限事故も直す** — 0041 のポリシー関数の execute が `authenticated` だけだったため、**未ログインの来場者から公開サイトが全滅していた**（0041 適用済みの環境は 0042 で回復する）
   - `0043_admin_add_room.sql` — 管理者の「展示室を追加」で**部屋が実際に増える**(`admin_add_room` RPC。台帳への記録と `galleries` の作成を1トランザクションで。**台帳→部屋の順**でないと 0038 の `enforce_room_allowance` が自分のinsertを弾く。部屋は有料等級=`slots_included`/15枠で作る。slugは空いている `room-N`。**冪等にしない**=押した回数だけ増える)
   - `0044_expos.sql` — **合同展示(Expo)の土台**(`expos` 表＋`galleries.expo_id`)。`/expo/{name}` で開き**会期**を持ち、**主催者が公開時に場所代を払う**(7日\$15 / 14日\$25 / 30日\$40)。要点: ①**見える/見えないは日付から導出**(`expo_is_live`。自由な旗を置かないので削除ジョブが止まっても会期切れは公開されない) ②**支払いと公開は1つの操作**(`record_expo_purchase`。service role 限定＝クライアントから公開できる経路が無い) ③**合同展示の部屋は $25 の枠を消費しない**(`enforce_room_allowance` を差し替え) ④猶予7日のあと `purge_expired_expos` が消す(**参加作家の作品は残る**)。**pg_cron が無効なら掃除ジョブは登録されず NOTICE が出る** — Dashboard → Database → Extensions で有効にしてから流し直す
   - `0045_expo_public_read.sql` — 合同展示を**会期のあいだだけ・専用URLでだけ**見せる。0044 だけでは読み経路が足りず、**主催者が部屋の公開スイッチを入れれば場所代を払う前から見えて**しまい、しかも `/@ハンドル` と `/explore` にも混ざった。①`galleries_select_public` を `is_public and expo_id is null` に締める ②会期だけで開く `galleries_select_expo_live` と、配置・作品の同条件のポリシー ③**合同展示の部屋は `is_public` を持てない**（トリガが無条件に false。ポリシーはORで足されるので、`is_public` で絞る既存クエリが会期中の部屋を拾ってしまうのを塞ぐ）④`/expo/{name}` を**合同展示とアカウント別名(0040)が取り合う**のを互いに弾く（既存の重複は NOTICE で知らせるだけ＝どちらを残すかは人が決める）。**ポリシーで呼ぶ関数は anon にも grant**（0041 の事故と同じ形）
   - `0046_expo_engagement.sql` — **合同展示でも来場・芳名帳・いいねが動く**ようにする。0045 で合同展示の部屋は `is_public` を持てなくしたが、来場者の関わり方を許すポリシーは全部 `is_public` を見ていた＝**会期中でも芳名帳のフォームは出るのに書けず**（来場者にはただのエラー）、いいねも押せず、3Dの人影も出なかった＝**場所代を払った展示でだけ体験が欠けていた**。ポリシーは OR で足されるので既存のものは触らず「会期の生きている合同展示なら通す」を並べて足す（`is_public` 側の意味を1文字も変えないので通常展示に回帰が出ない）。関数は足せないので `public_visit_count` だけ全文を置き換える。`guestbook_enabled` は尊重する（主催者が閉じていれば閉じたまま）
   - `0047_expo_invites.sql` — **招待を合同展示（`expos`）のものにする＝部屋への招待を撤去**（ユーザー選択A）。0037/0041 は招待も提出も**部屋単位**だったが、合同展示は部屋を複数ぶら下げられる（0044）ので、そのままだと**2室目を作るたびに招き直し**が必要だった。招待は「この展示に参加しますか」の1回の話。**提出も展示単位**にして、どの部屋に掛けるかは主催者が決める（作家に部屋を選ばせると、主催者が構成を変えたときに同意が迷子になる）。`expo_invites` / `expo_submissions` を作り、`may_place_artwork` の②を「その部屋が属する展示への受諾済み招待＋その展示への提出」に読み替え、0042 の通知3本を新しい表に載せ替える（`notifications.gallery_id` は入れない＝合同展示に対応する部屋は1つに決まらない）。最後に `room_invites` / `room_submissions` と、使えなくなった関数・ポリシーを落とす。**引き継ぐ形**: 作家が出す(push)・同意は作品単位・辞退でその場で壁から下りる・述語は `security definer`・**ポリシーが呼ぶ関数は anon にも grant**
   - `0048_expo_invite_links.sql` — **招待リンク**（配れる1本のURLで参加希望を集め、主催者が承認する。ユーザー決定 2026-08-10）。状態を1つ増やす（`requested` = 作家が希望を出した・主催者の承認待ち）。**`requested` は何の権限も与えない** — `may_submit_to_expo` は `accepted` しか見ないので、承認前は1点も出せず壁にも掛からない＝リンクが流出しても実害は「承認待ちが増える」だけ（主催者が `revoked_at` で止められる）。トークンは**サーバが決める**（`create_expo_invite_link`。`gen_random_uuid()` 2本＝64文字。pgcrypto に依存しない）。**リンクの表は主催者以外に select させない** — 一覧できたら「知っていること」が鍵にならない。踏んだ人は `expo_by_invite_token`（definer・anon可）で題名・主催者・会期だけを引く。**自分で自分を承認できないようにガードを入れた**（0047 の作家向け update ポリシーは自分の行を accepted にできるので、そのままだと希望を出した本人が承認できてしまう）。通知は2種類追加（`invite_request` → 主催者 / `invite_approved` → 作家）
   - `0049_expo_launch_guard_fix.sql` — **合同展示の確定バグ2件を塞ぐ**（別視点レビュー 2026-08-10、PR #8 マージ前に発見。素のPostgresで実際に再現して確認済み）。①`guard_expo_run` が `before update` にしか付いておらず、authenticated が **INSERT で `starts_at` を自分で入れると、決済を一度も通さずに即座に公開できた**（30日ぶん・$0で再現） → トリガを `before insert or update` に広げ、INSERT でも `starts_at is not null` を拒否する。②`enforce_room_allowance` が `new.expo_id is not null` なら無条件に return していたため、**他人の展示のIDを付けるだけで所有者チェックも work_cap の上限チェックも一切素通りし、work_cap=999999 の部屋が無料で作れた**（他人の展示に紐づく形で再現） → `expo_id` の所有者が `new.owner_id` と一致するかを確認し、work_cap も15枠上限を通すように直した。
   - `0050_room_expo_toggle.sql` — **部屋を「通常展示↔合同展示」に切り替える**（ユーザー指示 2026-08-10。範囲は**作成直後・空の部屋だけ**に絞った — 作品を置いた後の部屋を動かすには参加作家の同意・配置の巻き戻しが要る本格的な工事になるため）。「空」は日付ではなく**その部屋の `placements` が0件であること**で判定する。唯一の書き込み経路 `switch_room_expo(gallery, expo|null)` を新設し、①呼び手がその部屋の所有者であること②部屋が空であること③合同展示に入れるときはその展示が呼び手自身のものであること（0049と同じ理由でただ乗りを禁止）④通常展示に戻すときは**この部屋を除いた台帳**で無料/有料の等級を判定し、空きが無ければ拒否する、を守る。直接の `update galleries set expo_id=...` は追加のトリガで塞ぎ、必ずこの関数を通す（`security invoker` で呼び手のロールを見るガード。0036と同じ作法）。
   - `0051_expo_schedule.sql` — **合同展示の公開日時を予約できるようにする**（ユーザー指示 2026-08-10。上限は無し）。`record_expo_purchase` に7つ目の引数 `p_starts_at`（省略時は従来どおり即時）を追加。**`expo_is_live()` の判定式は元から `now() >= starts_at` だった**ので、未来の日時を入れるだけで「まだ始まっていない」がそのまま表現できる ── DB側の判定ロジックは1行も変えていない。旧6引数版は落とし、既定値で6引数呼び出しも解決される。**このファイルを書く過程で確定バグを1件見つけて同時に直した**: 2つのチェックアウトを並行して開き両方で支払いを終える競合状態で、2件目が別セッションidを持つため「再送判定」（セッションidの一致）を素通りし、`purchases (user_id, kind, item_key)` の一意制約に落ちて**webhookがクラッシュ→Stripeが延々と再送する**状態を実際に再現した。判定を「このセッションid、または**この展示への支払いが既にある**」に広げて解決（先勝ちのまま台帳が1本になる）。
   - `0052_room_capacity_transfer.sql` — **作品スロットを部屋間で移動する**（ユーザー指示・DECISIONS 2026-08-10。無料室5枠＋合同展示部屋15枠＝合計20枠を、口座内で合計を変えずに自由に配分し直せるようにする）。`galleries.work_cap` の構造は変えず、唯一の書き込み経路 `transfer_room_capacity(from, to, amount)` を新設。①移動元・移動先どちらも呼び手の所有であること②移動元は移動後も最低1枠残す③移動先は物理上限（15枠）を超えない、を守る。`switch_room_expo`（0050）と同じ理屈で `security definer` にし、`guard_work_cap_raise`（0036）の「authenticated/anonからの引き上げ拒否」を関数の内側だけ素通りさせる。**→ 0053で撤回。**
   - `0053_drop_room_capacity_transfer.sql` — **0052の「移動」を撤回**（ユーザー指摘・DECISIONS 2026-08-11。「移動とかややこしいので、共通扱いにしてほしい」）。部屋ごとに別々の数字を考えず、口座全体で1つの残り枠数だけを扱う方式（本当の共通プール）に作り直した。集計（全部屋の`work_cap`の合算）は`lib/limits.poolCapacityOf`でアプリ側だけが行うので、DB側は0052で作った移動用のRPCを`drop function if exists`で落とすだけ。`galleries.work_cap`列・等級ロジック・購入経路は無変更。
   - `0054_crop_align.sql` — **作品画像のトリミング位置**（ユーザー指示・DECISIONS 2026-08-12）。`artworks.crop_align`（`start`/`center`/`end`、既定`center`）を新設。3D側（`Exhibit.tsx`）が画像を実寸のサイズに合わせてカバー表示（cover-fit）する際、これまで常に中央基準でトリミングしていたのを、作家が3択（開始/中央/終了）で選べるようにする。
   - `0055_artwork_purchase_links.sql` — **購入リンクを複数化**（ユーザー指示・DECISIONS 2026-08-12。「壁紙やNFTなどある場合」）。`artworks.purchase_url`（単一URL）を`purchase_links`（`{label, url}`の配列・jsonb）に置き換える。既存の`purchase_url`は空ラベルの1件としてバックフィルしたうえで列を削除（二重の真実の元を残さない）。ラベルは作家の自由入力（固定の種類を用意しない）。
   - `0056_report_dmca.sql` — **通報にDMCAの法定要件を記録**（ユーザー決定・DECISIONS 2026-08-12・D-4）。`reports` に `kind`（`copyright`/`harassment`/`illegal`/`other`）、`claimant`（申立人の氏名＝電子署名）、`work_identified`（侵害されたとする著作物の特定）、`sworn`（善意の申立てと偽証罰の下での宣誓への同意）を追加する。米国 17 U.S.C. §512(c)(3) が有効な削除通知に要求する4要素を受け取っていなかったため（＝有効な通知が1件も届かず、§512セーフハーバーの前提が成立しない状態）。**著作権の通報だけ**4要件を要求する check 制約を置く（嫌がらせの報告に偽証罰の宣誓を求めるのは筋が違うので種別で分ける）。既存行を壊さないため `not valid`（新しい行には効く）。閲覧ポリシーは引き続き作らない——申立人の氏名と連絡先は個人情報。
   - `0057_notify_unsubmit.sql` — **会期中の取り下げを主催者に知らせる**（ユーザー指示 2026-08-12）。提出には通知があるのに取り下げには無く、**場所代を払って開催中の展示から作品が1点消えても主催者が気づけなかった**。通知の種別に `unsubmit` を足し、`expo_submissions` の `after delete` で主催者へ送る。通知するのは**支払い済みかつ会期が終わっていない**ときだけ（下書き中は選び直しの雑音になり、終了後は誰にも見えていない）。展示ごと削除した cascade では親が見えないので1件も飛ばさない。作品ごと削除された場合は通知する（会期中の展示から消えたことそのもの）が、作家名は引けないので空になる。
   - `0058_replace_placements.sql` — **配置の書き換えを1トランザクションにする**（ユーザー決定 2026-08-12・B案の前提工事）。`replace_placements(p_gallery, p_rows)` を新設し、`lib/galleries.rebuildPlacements` の「upsert してから余りを delete する」**2回のリクエスト**を1回のRPCに置き換える。**振る舞いは1つも変わらない** — 次の工程（枠の上限をDB側で強制する）の土台。旧経路はあいだの状態がコミットされるため、作品を枠3から枠7へ動かすだけで15枠の部屋が一時的に16行になり、件数を数えるトリガを置くと**正常な操作が拒否される**（過去2回の「配置タブでD&Dできない」と同じ形）。**`security definer` にしない**のが要点で、`placements` のRLS（0037 `placements_owner_all`: using=部屋の所有者／with check=所有者かつ `may_place_artwork`）がそのまま効くので、権限と同意の判定を関数に書き写さずに済む。所有者チェックだけは関数の先頭で明示的に落とす（RLS任せだと他人の部屋に空配列を渡したとき「成功」して返るため）。SQLテスト18項目（`security definer` にすると4項目・所有者チェックを外すと2項目が赤くなることも実測）。
   - `0059_pool_limits.sql` — **作品枠の上限をDB側で強制する**（ユーザー選択 2026-08-12・B案の第2段）。それまで上限は**ブラウザの中だけ**で守られていた（`/api/upload-url` は保存容量300MBしか見ず、`artworks` に件数のトリガもポリシーも無く、`placements` のトリガ（0037/0041/0047）は同意取り消しで壁から下ろすだけ）。数える単位は**口座全体**（`lib/limits.poolCapacityOf` と同じ意味。部屋ごとの固定割りは 2026-08-12 に撤廃したので、その部屋の `work_cap` で縛ると正しい操作を拒否する）。判定の材料は `work_slot_pool()`（枠の合計・下限5で部屋ゼロの口座を締め出さない）と `placement_pool_used()`（使用点数）**の2つだけ**で、トリガと `replace_placements` の両方がそれを呼ぶ（DECISIONS【絶対ルール】2026-08-12）。トリガは `artworks` / `placements` に **statement 単位＋遷移表**で載せる。**要点は「すでに超過している部屋を閉じ込めない」こと** — 枠は部屋の削除や合同展示からの離脱（0050 が `work_cap` を15→5に戻す）で普通に減るので、厳密に `使用<=上限` を課すと `replace_placements` が全行を書き直す形ゆえ**「1点外す」保存すら拒否され二度と直せなくなる**。そこで「**操作前より増やしていない**なら通す」を併記し、操作前の点数は `note_placement_baseline()`（definer・引数なし＝自分の分しか見ない）がトランザクション限りの設定に申告する。設定が無い＝RPCを通らない直接の書き込みなので**厳密に**判定される。判定の材料の関数は `anon`/`authenticated`/`service_role` から**明示的に revoke する** — Supabase は `alter default privileges` で3ロールに execute を与えているので `revoke from public` では外れない（この穴はSQLテスト22が実際に検出した）。**UPDATE は物理上限だけ見る** — `update placements set gallery_id=…` は行を部屋のあいだで動かすだけで、RLS が移動元も移動先も所有者に限るので**口座の合計は動かせない**（見ても得るものが無く誤拒否だけ増える）。一方 A室の 0..14 と B室の 15 を寄せると16行になるので、物理上限は UPDATE でも見る（別視点レビュー指摘）。遷移表は複数イベントのトリガに付けられない（`transition tables cannot be specified for triggers with more than one event`）ので、`placements` は insert 用と update 用の**2本**に分けて同じ関数を呼ぶ。SQLテスト29項目。口座全体でなく固定値で数えるように壊すと・超過中の猶予を外すと、それぞれ赤くなることも実測。
   - `0060_profile_cv.sql` — **プロフィールに「来歴」を足す**（ユーザー要望 2026-08-13）。`profiles.cv`（`text not null default ''`）を追加。展示歴・受賞歴は箇条書きで積み上がる記録で、読み物である自己紹介（`bio`）と混ぜると3Dの情報パネルで「自己紹介の続きに年号が延々と並ぶ」形になり両方読みにくい。別列にしてパネルをタブ（展示情報／自己紹介／来歴）に分けた。RLSは 0002 の `profiles_self_update` / 公開read がそのまま効くので新しいポリシーは無い。SQLテスト6項目。
3. 「Success. No rows returned」が出れば完了

**番号順に流すこと**が前提です。後の番号が前の番号を上書きする箇所があります —
`purchases_kind_check`(0019→0034)、`record_capacity_purchase`(0019→0028→0031)、
`grant_entitlement`(0022→0034)、`guestbook_insert_public`(0008→0033)、
`placements_owner_all`(0001→0037)、`enforce_room_allowance`(0036→0038)、`profiles.subdomain`→`expo_slug`(0039→0040)、`may_place_artwork`(0037→0041)、`drop_placements_on_revoke`(0037→0041)、`invited_to_room` などの実行権限(0041→**0042 で anon にも付与＝これが無いと公開サイトが見えない**)。

作られるもの: `profiles` / `artworks` / `galleries` / `placements` テーブル(RLS付き)、
`artworks` ストレージバケット、サインアップ時のプロフィール自動作成トリガー。

## 2. 認証の設定

### メール(パスワード / マジックリンク)— 追加設定なしで動く

パスワード認証(`/signup` `/signin` `/reset`)も同じ Email プロバイダで動作する。
[Authentication → Sign In / Providers](https://supabase.com/dashboard/project/ncffdcvsksiutsjerpeb/auth/providers) で
**Confirm email が有効**になっていることを確認(登録時に確認メールを送る設定)。

デフォルトで有効。ただし Supabase 内蔵のメール送信は**1時間あたり数通**の
レート制限がある(開発用)。本公開の前に独自SMTP(Resend等)を
[Authentication → Emails](https://supabase.com/dashboard/project/ncffdcvsksiutsjerpeb/auth/templates) で設定する。

**Site URL / Redirect URL**: [Authentication → URL Configuration](https://supabase.com/dashboard/project/ncffdcvsksiutsjerpeb/auth/url-configuration) で
- Site URL: `http://localhost:3000`(開発中)
- Redirect URLs に `http://localhost:3000/**` を追加

Vercel デプロイ後は本番URLも同様に追加する。

### Google ログイン(任意・後からでも可)

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で
   OAuth クライアント(Webアプリ)を作成
2. 承認済みリダイレクトURIに
   `https://ncffdcvsksiutsjerpeb.supabase.co/auth/v1/callback` を登録
3. 取得した Client ID / Secret を
   [Authentication → Providers → Google](https://supabase.com/dashboard/project/ncffdcvsksiutsjerpeb/auth/providers) に設定して有効化

アプリ側は設定済み(未設定のままGoogleボタンを押すとSupabaseがエラーを返すだけ)。

### Instagram / Facebook(フェーズ2)

Meta開発者アプリ + アプリ審査が必要。docs/ARCHITECTURE.md 6章を参照。

## 3. ローカルでの動作確認

```bash
cp .env.example .env.local
npm install && npm run dev
```

http://localhost:3000/demo → 「空間を編集」→ アカウント欄からメールアドレスで
ログインリンクを送信 → メール内リンクで戻ってくるとログイン状態になる。
以後の「作品を出展」はクラウド(Storage + DB)に保存され、別ブラウザでも同じ作品が並ぶ。

## 4. 管理画面(`/admin`)を有効化する

`0017_admin.sql` を適用したうえで、自分を管理者に登録する(SQL Editor で1回だけ):

```sql
insert into public.admins (user_id, note)
select id, 'founder' from auth.users where email = 'あなたのメール@example.com';
```

その後 `/admin` にサインインした状態でアクセスすると、総課金額・ユーザーごとの保有パッケージ・
全展示空間(非公開含む)が見られる。アクセス制御はRLS(`is_admin()`)が本体で、管理者でない
セッションは何も読めない(クライアント側の判定は表示用)。クライアントから自分を管理者に
昇格する経路は用意していない(`admins`にinsertポリシーなし。登録はSQL Editor / service roleのみ)。

- **総課金額**は決済未接続のあいだ ¥0 のまま。Stripe webhook が `purchases` に
  `sku` / `amount_jpy` を記録すれば自動で集計される(webhook実装済み — §5参照)。
- ユーザーのメールアドレスは `auth.users` にあり anon キーでは読めないため、管理画面には出さない
  (必要なら Authentication ダッシュボードで確認)。
- **LPヒーロー表示作品**: `0018` 適用後、`/admin` の「Landing page hero」から中央/左/右の3枠に
  画像をアップロードして差し替えられる(PC/モバイル共通)。未設定の枠は内蔵のデモ作品にフォールバック。
  画像は `artworks` バケットの管理者フォルダに保存され、LPは公開URLをテクスチャとして読み込む。

## 5. Stripe 決済を有効化する(任意 — 未設定でもアプリは壊れない)

コードは実装済み(`app/api/checkout` / `app/api/stripe/webhook`)。**環境変数を設定した時だけ有効**になり、
未設定のあいだ購入ボタンは従来どおり「Checkout isn't live yet」の正直表示にフォールバックする。

1. `0019_checkout.sql` を適用する(kind拡張 + `record_capacity_purchase` RPC)
2. [Stripe Dashboard](https://dashboard.stripe.com/apikeys) で Secret key を取得 → サーバー環境変数
   `STRIPE_SECRET_KEY` に設定(Vercelなら Project → Settings → Environment Variables)
3. [Webhooks](https://dashboard.stripe.com/webhooks) で endpoint `https://本番ドメイン/api/stripe/webhook` を作成し、
   イベント `checkout.session.completed` を購読 → Signing secret を `STRIPE_WEBHOOK_SECRET` に設定
4. Supabase の **service_role キー**を `SUPABASE_SERVICE_ROLE_KEY` に設定(webhookが台帳へ書くため。
   サーバー環境変数のみ・`NEXT_PUBLIC_` を付けないこと)
5. (推奨)`NEXT_PUBLIC_SITE_URL` に本番URLを設定(決済完了後のリダイレクト先の明示)

ローカル検証: `stripe listen --forward-to localhost:3000/api/stripe/webhook`(Stripe CLI)で
テストモードのイベントを転送し、テストカード `4242 4242 4242 4242` で購入する。

現在購入可能なSKU: キャパ+5(¥580)・テーマ/レイアウト単品(¥400)・Theme Collection(¥2,480)・
Design Tools(¥1,480)。Video Pass(サブスク)と「展示室を追加」は未配線のため意図的に販売対象外
(`app/api/checkout/route.ts` の `ONE_TIME_SKUS`)。

## 補足

- 公開してよいキー: **Publishable key**(`sb_publishable_...`)のみ。
  `service_role` / Secret key は絶対にリポジトリやクライアントに置かない。
- RLS方針: 自分の行だけ書ける / 公開ギャラリー(`is_public`)に属するものは誰でも読める。
- 画像パス: `artworks/{owner_id}/{artwork_id}/display.jpg`(長辺1600)と `thumb.jpg`(長辺400)。
