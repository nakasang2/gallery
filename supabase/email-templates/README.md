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

- **アプリと同じ暗いブランドデザイン**（ユーザー選択 2026-08-03、明るい版から変更）。
  背景 `#0d0c0a` / 墨カード `#16130f` / 文字クリーム `#ece7de` / 本文 `#a8a196` /
  金アクセント `#d4a24e` / ボタン文字 `#14110c`。
- **暗い版の崩れ対策**: テーブルレイアウト＋インラインCSSに加え、外枠・カード・
  ボタンに `bgcolor` 属性を併記（Outlook は多くの要素で CSS の background を無視
  するため）。全テキストに明示的な色を指定し、ダークモードのクライアントが色を
  反転させないようにしている。
- **⚠️ 最重要（実機で発見・2026-08-03）**: `<head>` に
  `<meta name="x-apple-disable-message-reformatting">` が無いと、**Apple Mail が
  独自に「読みやすく」メールを作り替える際、外側の背景色だけを剥がす**（中の
  カード・ボタンの色は保持されるので原因に気づきにくい）。`color-scheme` の
  宣言だけでは止まらず、この作り替え自体を無効化する専用メタタグが必須。
  詳しい切り分け経緯は `docs/LESSONS.md` の該当エントリを参照。
  **4テンプレートすべてこのメタタグ込みの完全なHTML文書（`<!DOCTYPE html>`〜
  `</html>`）**になっている。断片（`<table>`から始まる）に戻さないこと。
- 送信元は `no-reply@xibit360.art`、問い合わせ先は `support@xibit360.art`
  （後者は Cloudflare Email Routing の受信設定が別途必要＝STATE の残タスク）。
