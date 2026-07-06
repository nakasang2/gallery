# Supabase セットアップ手順

プロジェクト: `ncffdcvsksiutsjerpeb`(URL・キーは `.env.example` 参照)

## 1. スキーマの適用(必須・1回だけ)

1. [SQL Editor](https://supabase.com/dashboard/project/ncffdcvsksiutsjerpeb/sql/new) を開く
2. `supabase/migrations/` のSQLを**番号順に**全文貼り付けて **Run**
   - `0001_init.sql` — テーブル・RLS・ストレージ(適用済み)
   - `0002_video.sql` — 動画作品対応(kindカラム追加)
3. 「Success. No rows returned」が出れば完了

作られるもの: `profiles` / `artworks` / `galleries` / `placements` テーブル(RLS付き)、
`artworks` ストレージバケット、サインアップ時のプロフィール自動作成トリガー。

## 2. 認証の設定

### メール(マジックリンク)— 追加設定なしで動く

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

## 補足

- 公開してよいキー: **Publishable key**(`sb_publishable_...`)のみ。
  `service_role` / Secret key は絶対にリポジトリやクライアントに置かない。
- RLS方針: 自分の行だけ書ける / 公開ギャラリー(`is_public`)に属するものは誰でも読める。
- 画像パス: `artworks/{owner_id}/{artwork_id}/display.jpg`(長辺1600)と `thumb.jpg`(長辺400)。
