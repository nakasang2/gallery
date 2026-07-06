# HAKONIWA 本格移行 アーキテクチャ設計

> 2026-07 決定。プロトタイプ(Vite + Vanilla JS + Three.js)から本番構成への移行方針。

## 0. 決定事項サマリ

| 論点 | 決定 |
|---|---|
| フレームワーク | **Next.js (App Router) + TypeScript** — ただし「SPA風運用」(後述) |
| 3D | **React Three Fiber + drei**(Three.js継続) + `@react-three/postprocessing` |
| 状態管理 | **zustand** |
| バックエンド | **Supabase**(Auth / PostgreSQL / Storage) |
| 認証 | フェーズ1: **メール + Google** → フェーズ2: **Instagram / Facebook**(Meta審査後) |
| 画像 | クライアント側リサイズ → Supabase Storage に2サイズ保存(CDN変換は後付け) |
| ホスティング | **Vercel** |
| リポジトリ | モノレポにしない。Next.js単一アプリ + `supabase/` マイグレーション |

## 1. Next.js を選んだ理由と「SPA風運用」

決め手は **SNS共有カード(OGP)**。ギャラリーURLをX/LINE/Discordに貼ったとき、
プレビューを生成するクローラーはJSを実行しないため、SPAでは全ページ共通の
空殻HTMLしか見えない。サーバーが `@username/slug` の中身を含むHTMLを返せる
Next.jsなら、作品サムネイル+展覧会タイトル付きカードが出る。
「SNSで作品を発表している人の展示空間」というコンセプト上、共有カードは
集客の玄関であり、後付け移行のコストを払うより最初から担保する。

ただしフル機能は使わない。**SPA風運用**とする:

- サーバー側の仕事は「公開ページのHTML生成 + OGPメタタグ/OG画像」に限定
- ギャラリー3D・エディタ・マイページは全てクライアントコンポーネント
- 3D(R3F)は `next/dynamic` の `ssr: false` で完全にブラウザ専用として読み込む
- サーバーコンポーネントの深い機能(Server Actions等)には当面依存しない

## 2. 構成図

```
ブラウザ
 ├─ Next.js (App Router, TypeScript, Vercel)
 │   ├─ / (LP) ・ /@[username]/[slug] (公開ギャラリー; SSRでOGP付与)
 │   ├─ /me (マイページ) ・ /me/editor (配置エディタ)  … クライアント描画
 │   └─ 3Dビュー: React Three Fiber + drei + zustand
 │        └─ ポストプロセス: @react-three/postprocessing (+ N8AO)
 └─ Supabase
     ├─ Auth: メール + Google (→ 後日 Instagram/Facebook)
     ├─ PostgreSQL + RLS
     └─ Storage: artworks バケット(original / display の2サイズ)
```

## 3. データモデル

プロトタイプv0.2の設定構造(theme / layout / frame / frameOverrides)を
そのままリレーショナルに写す。

```sql
-- ユーザープロフィール(auth.users と 1:1)
profiles   (id uuid PK → auth.users, username text unique,
            display_name text, bio text, avatar_url text, sns jsonb)

-- 作品(画像の実体は Storage、ここはメタデータ)
artworks   (id uuid PK, owner_id uuid → profiles,
            storage_path text, width int, height int,
            title text, description text, year int, tags text[],
            created_at timestamptz)

-- ギャラリー(=展覧会)
galleries  (id uuid PK, owner_id uuid → profiles, slug text,
            title text, statement text,
            theme text, layout text, frame_default text,
            is_public boolean default false,
            unique (owner_id, slug))

-- 配置(どの作品をどのスロットにどの額装で)
placements (id uuid PK, gallery_id uuid → galleries,
            artwork_id uuid → artworks,
            slot_index int, frame_override text,
            unique (gallery_id, slot_index))
```

RLS方針:

- `artworks` / `galleries` / `placements`: owner のみ INSERT/UPDATE/DELETE
- `galleries.is_public = true` のギャラリーと、その placements・artworks は誰でも SELECT 可
- `profiles`: 本人のみ UPDATE、SELECT は公開

## 4. URL設計

| パス | 内容 | レンダリング |
|---|---|---|
| `/` | LP | 静的 |
| `/@[username]` | 作家プロフィール + ギャラリー一覧 | SSR(OGP) |
| `/@[username]/[slug]` | 公開ギャラリー(3D) | SSRでメタ、3Dはクライアント |
| `/demo` | 現行デモ(ゲスト体験、localStorage) | クライアント |
| `/me`, `/me/editor` | マイページ / エディタ(要ログイン) | クライアント |

OG画像は `next/og` で「代表作サムネ + 展覧会タイトル + 作家名」を動的生成。

## 5. 画像パイプライン

1. アップロード時にクライアントで検証(形式/サイズ)
2. ブラウザ内でリサイズ: display用(長辺1600px, JPEG/WebP)と thumb用(長辺400px)
3. Supabase Storage `artworks/{owner_id}/{artwork_id}/{size}.jpg` に保存
4. 縦横比はアップロード時に計測して `artworks.width/height` に保存
   (3D側の額装サイズ自動算出はこの値を使う — v0.2実装を踏襲)

サーバーサイド変換(Supabase Pro の image transform / Cloudflare Images)は
トラフィック増加後に後付けできるため初期は導入しない。

## 6. 認証

- フェーズ1: メール(マジックリンク) + Google OAuth。Supabaseの設定のみで完結
- フェーズ2: Instagram / Facebook(Meta開発者アプリ + アプリ審査 + ビジネス認証が必要。
  審査は数日〜数週間かかるため、メール+Googleのリリースをブロックしない)
- 補足: ここで作るMetaアプリは、将来の Instagram Graph API 連携
  (要件 8-2 の作品インポート)と同一アプリを使い回せる

## 7. 3D移植方針(プロトタイプ → R3F)

| プロトタイプ (src/gallery.js) | 移行先 |
|---|---|
| buildWorld / 部屋・額装・照明の構築 | `<GalleryScene>` 配下の `<Room>` `<Exhibit>` `<Lighting>` コンポーネント |
| config.js のプリセット定義 | ほぼそのまま TypeScript 化(`lib/presets.ts`) |
| 操作系(ドラッグ/WASD/ジョイスティック/ツアー) | カスタムhooks(`useWalkControls`, `useTour`) |
| ポストプロセス(N8AO/Bloom/SMAA) | `@react-three/postprocessing` |
| 静的ベイク影(shadowMap.autoUpdate=false) | 同方式を維持(`invalidate` ベースの省電力描画も検討) |
| localStorage 設定 | ゲストモードとして温存。ログイン時はSupabaseに移行 |

## 8. 移行ステップ

1. **基盤移植** — Next.js + TS + R3F。完了条件「現デモと同じ見た目・機能」。
   バックエンドなしでも動く(ゲストモード = localStorage)
   → **完了(v0.3)**。LP は `app/page.tsx`、3D は `/demo`(`components/gallery/` + `lib/`)。
   Playwright で14項目の機能検証済み
2. **Supabase接続** — スキーマ + RLS + 認証(メール/Google) + 作品アップロード
   → **コード実装済み(v0.3)**。スキーマ適用と認証設定の手順は `supabase/README.md`。
   ログイン時の出展は Storage + DB、ゲストは従来どおり localStorage
3. **公開** — `@username/slug` 公開URL、公開トグル、OGP画像生成
4. **エディタ強化** — 配置入れ替え、ギャラリー複数管理、プロフィール編集
5. **(以降)** Meta認証・IG連携、アクセス解析、芳名帳 … 要件フェーズ2へ

## 9. 費用感(初期)

- Supabase Free: DB 500MB / Storage 1GB / MAU 50k — 検証〜初期リリースは無料
- Vercel Hobby: 個人検証は無料(商用化時に Pro $20/月)
- 独自ドメイン取得のみ実費
