# 認証メールテンプレート（英語のみ）

Supabase が送る認証メール（確認・サインインリンク・パスワード再設定・メール変更）の
XIBIT360 ブランド版 HTML。**英語1種類**で運用する。

## なぜ英語1種類か

Supabase の内蔵メールテンプレートは**受信者の言語に関わらず1種類のテンプレートを送る**
（言語ごとの出し分け機能がない）。アプリUIは11言語だが、認証メールだけは英語1通になる。
本当に言語別に出したい場合は認証メールを自前バックエンド（Auth Hook + Resend）へ
載せ替える別工事が必要（ユーザー判断で2026-08-03に英語のみを選択）。

## 貼り付け場所

Supabase Dashboard → **Authentication → Email Templates** の各タブに、対応する
`.html` の中身を貼り、Subject を下表のとおり設定する。

| ファイル | テンプレートタブ | Subject |
|---|---|---|
| `confirm-signup.html` | Confirm signup | `Confirm your XIBIT360 account` |
| `magic-link.html` | Magic Link | `Your XIBIT360 sign-in link` |
| `reset-password.html` | Reset Password | `Reset your XIBIT360 password` |
| `change-email.html` | Change Email Address | `Confirm your new email for XIBIT360` |

## 使っている変数（Supabase が差し込む）

- `{{ .ConfirmationURL }}` — クリック先のワンタイムURL（全テンプレート）
- `{{ .Email }}` — 新しいメールアドレス（change-email のみ）

## 前提（先に済ませること）

1. 独自SMTP（Resend 等）を Authentication → Emails に設定 — 内蔵メールは1時間に数通の
   レート制限があり本公開に耐えない。
2. Authentication → URL Configuration の Site URL / Redirect URLs を本番ドメインに。
   ここが本番URLでないと、メール内リンクの戻り先がずれる。

## 補足

- メールクライアント互換のためテーブルレイアウト＋インラインCSS。ダークモードは
  クライアント任せ（明るい紙面＋金アクセントで固定）。
- 送信元は `no-reply@xibit360.art`、問い合わせ先は `support@xibit360.art`
  （後者は Cloudflare Email Routing の受信設定が別途必要＝STATE の残タスク）。
- ブランド色: 金 `#d4a24e` / 墨 `#14110c`。アプリの `--gold` と揃えている。
