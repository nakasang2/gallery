# DECISIONS

## 現在の前提・絶対ルール
- **サービス名は Xibit360**（旧 HAKONIWA）。表記: ロゴ/マーク=`XIBIT360`（全大文字）、文中/メタデータ/OG=`Xibit360`（Title case）。ユーザーの1ギャラリーを指す普通名詞は英語UIで `gallery`/`galleries`、日本語docで「ギャラリー」。
- **本番の公開URLは https://xibit360.art**（ムームードメイン取得・Vercel Production）。ship時の反映確認はこのドメインをポーリングする。Vercelの自動生成URL（`*-projects.vercel.app` 等）はDeployment Protectionでログイン必須になり得るので共有・埋め込みには使わない。

## 並行セッションの担当
- （並行して動く別セッションの担当領域をここに記録する）

---

## 2026-07-09 自己改善ループの導入
- 決定: user-interview-tool で構築した自己改善ループ（STATE/LESSONS/DECISIONS 台帳・/kaizen スキル・push前検証ループ）をこのリポジトリにも導入。リモート実行（claude.ai Webセッション）でも効くようリポジトリにコミットするハイブリッド構成
- 補足: 運用ルール本文は AGENTS.md、棚卸しスキルは .claude/skills/kaizen を参照

## 2026-07-21 本番ドメインを xibit360.art に確定
- 決定: ムームードメインで取得した `xibit360.art` を Vercel Production に割り当て。ムームーDNSにカスタムレコード（apex A `76.76.21.21` / www CNAME `cname.vercel-dns.com`）を設定して接続、SSLはVercel自動発行。
- 効果: ship時の反映確認は `https://xibit360.art` をポーリング（毎回デプロイURLを探さない）。埋め込みコードの `src` もこのドメインを使う。

## 2026-07-21 サービス名を HAKONIWA → Xibit360 に変更
- 決定: リブランド。表記ルール = ロゴ/マーク `XIBIT360`、文中/メタデータ `Xibit360`。ユーザーの1ギャラリーを指す普通名詞は `gallery`/`galleries`（日本語docは「ギャラリー」）。
- 実装: コード全体（app/components/lib/docs/supabase、計35ファイル）を一括置換。保存キーは `xibit360.*` に改名（既存ユーザーのローカル設定/いいね履歴はリセットされる点を合意のうえ）。package名 `xibit360`、`HakoniwaCard`→`GalleryCard`、`window.__hakoniwa`→`__xibit360`、録画DL名 `xibit360-walkthrough.webm`。ドメイン文字列は `xibit360.art`（TLDは .art）。
