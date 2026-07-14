# Supabase セットアップ手順

プロジェクト: `ncffdcvsksiutsjerpeb`(URL・キーは `.env.example` 参照)

## 1. スキーマの適用(必須・1回だけ)

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
3. 「Success. No rows returned」が出れば完了

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

- **総課金額**は決済未接続のあいだ ¥0 のまま。将来 Stripe webhook が `purchases` に
  `sku` / `amount_jpy` を記録すれば自動で集計される(下地は 0017 で用意済み)。
- ユーザーのメールアドレスは `auth.users` にあり anon キーでは読めないため、管理画面には出さない
  (必要なら Authentication ダッシュボードで確認)。

## 補足

- 公開してよいキー: **Publishable key**(`sb_publishable_...`)のみ。
  `service_role` / Secret key は絶対にリポジトリやクライアントに置かない。
- RLS方針: 自分の行だけ書ける / 公開ギャラリー(`is_public`)に属するものは誰でも読める。
- 画像パス: `artworks/{owner_id}/{artwork_id}/display.jpg`(長辺1600)と `thumb.jpg`(長辺400)。
