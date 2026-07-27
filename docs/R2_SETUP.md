# Cloudflare R2 セットアップ・移行手順

ファイル（作品画像・動画・アバター・ロゴ・音声・TTSキャッシュ）の置き場を
Supabase Storage → Cloudflare R2 へ移す作業手順。認証とDBはSupabaseに残る。
背景と設計判断は docs/DECISIONS.md 2026-07-27 を参照。

**なぜR2か**: R2はegress（サーバーから外に出る通信量）が無料。作品が見られる回数に
比例して増える費用がゼロになる。保存も$0.015/GB月で、無料枠10GBまでは実質無料。

---

## 順番が重要

コードは「ファイルはR2にある」前提で動くので、**移送より先にデプロイすると画像が
表示されなくなる**。必ずこの順で進める。

1. Cloudflareの準備（§1〜§6）
2. Vercelに環境変数を設定（§7）
3. 既存ファイルをR2へ移送（§8）
4. DBのURLを書き換え（§9）
5. デプロイして確認（§10）
6. 問題なければSupabase Storageを空にする（§11）

---

## 1. Cloudflareアカウントを作る

1. https://dash.cloudflare.com/sign-up でアカウント作成（無料プランでよい）
2. メール認証を済ませる

## 2. ドメインをCloudflareに追加し、DNSを移管する

R2の独自ドメインは「そのドメインがCloudflareのゾーンである」ことが必須。移管を
避ける方法（部分CNAME設定・サブドメイン委任）はいずれもBusinessプラン（月$200超）
が必要なため、DNSごと移管する。

**現在のDNSレコードはこの2本だけ。MX（メール）もTXTもないので、メールへの影響はない。**

| 種別 | 名前 | 値 |
|---|---|---|
| A | `xibit360.art`（@） | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

手順:

1. Cloudflareダッシュボードで **Add a domain** → `xibit360.art` を入力 → **Free** プランを選択
2. Cloudflareが既存レコードを自動スキャンする。**上の2本が取り込まれているか必ず目視確認**
   （足りなければ手動で追加してから次へ進む）
3. 2本とも **Proxy status を「DNS only」（灰色の雲）** にする
   — Vercelが自前でTLSと配信をやるので、二重プロキシは避ける
4. Cloudflareが割り当てたネームサーバー2本（`xxx.ns.cloudflare.com` 形式）をメモ
5. **ムームードメイン**にログイン → `xibit360.art` のネームサーバー設定 →
   「取得したドメインで使用する」以外＝カスタム設定にして、4のネームサーバー2本に変更
6. 反映を待つ（通常数十分〜数時間、最大48時間）。Cloudflare側のステータスが
   **Active** になれば完了
7. 反映後、`https://www.xibit360.art` が今まで通り開くことを確認

## 3. R2バケットを作る

1. Cloudflareダッシュボード左メニュー → **R2 Object Storage** → 初回は課金情報の登録を求められる
   （無料枠内なら請求は発生しないが、カード登録は必要）
2. **Create bucket** → 名前は `xibit360-artworks` → Location は **APAC** を選択 → 作成

## 4. バケットに独自ドメインをつなぐ

1. 作ったバケット → **Settings** → **Public access** → **Custom Domains** → **Connect Domain**
2. `cdn.xibit360.art` を入力 → 接続。CloudflareがDNSレコードを自動で追加する
3. ステータスが **Active** になるまで待つ（数分）

> `r2.dev` の簡易URLは使わない。Cloudflare公式が「レート制限あり・開発用途のみ」と
> 明記しており、本番トラフィックでは詰まる。

## 5. CORSを設定する（**必須** — これが無いと作品が1枚も表示されない）

3D展示は作品画像をWebGLのテクスチャとして読むため、`crossOrigin="anonymous"` で
取得している。この方式ではブラウザが `Access-Control-Allow-Origin` ヘッダを要求する。
Supabase Storageは黙って返していたが、**R2はバケットにCORSポリシーを入れるまで
一切返さない**。アップロード（PUT）も同じ理由でCORSが必要。

バケット → **Settings** → **CORS Policy** → **Edit** に以下を貼る:

```json
[
  {
    "AllowedOrigins": [
      "https://www.xibit360.art",
      "https://xibit360.art",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- `GET`/`HEAD` は表示用、`PUT` はアップロード用
- `localhost:3000` はローカル開発用。不要なら消してよい
- **埋め込み（`?embed=1`）を他サイトで使う場合**は、そのサイトのオリジンも
  `AllowedOrigins` に追加する必要がある

## 6. キャッシュルールを設定する（任意・推奨）

配信をエッジでキャッシュさせると、R2への読み取りリクエスト自体が減る。

Cloudflareダッシュボード → `xibit360.art` → **Caching** → **Cache Rules** →
**Create rule**:

- 条件: `Hostname` equals `cdn.xibit360.art`
- 設定: **Eligible for cache** / Edge TTL を **1 month** など長めに

差し替えのあるファイル（アバター・ロゴ・LP画像・BGM）はURLに `?v=タイムスタンプ`
が付くので、長くキャッシュしても古い画像は残らない。

## 7. APIトークンと環境変数

1. R2の画面 → **API** → **Manage API tokens** → **Create API token**
2. 権限は **Object Read & Write**、対象は `xibit360-artworks` バケットのみに絞る
3. 表示される **Access Key ID** と **Secret Access Key** をコピー（Secretは一度しか出ない）
4. **Account ID** はR2ダッシュボード右側に表示されている

Vercel（Project → Settings → Environment Variables）に以下を設定:

| 変数名 | 値 | 公開 |
|---|---|---|
| `R2_ACCOUNT_ID` | CloudflareのAccount ID | サーバーのみ |
| `R2_ACCESS_KEY_ID` | 上の Access Key ID | サーバーのみ |
| `R2_SECRET_ACCESS_KEY` | 上の Secret Access Key | サーバーのみ |
| `R2_BUCKET` | `xibit360-artworks` | サーバーのみ |
| `NEXT_PUBLIC_R2_PUBLIC_BASE` | `https://cdn.xibit360.art` | ブラウザにも渡る |

ローカル検証用に `.env.local` にも同じ5つを書く（`.env.example` にも追記しておくとよい）。

> `NEXT_PUBLIC_` で始まる変数はビルド時にコードへ埋め込まれる。**後から追加した場合は
> 再デプロイが必要**。5つ揃うまでアップロード系のAPIは501を返して書き込みを拒否する
> （壊れたURLがDBに保存されるのを防ぐため）。

> `R2_SECRET_ACCESS_KEY` は秘密情報。チャットに貼らない。もし貼ってしまったら
> Cloudflareでトークンを削除して再発行する。

## 7.5 キャッシュパージ用のトークン（削除を即座に効かせる）

**なぜ必要か**: R2からファイルを消しても、Cloudflareのエッジ（世界各地の配信拠点）に
残ったコピーは最大4時間そのまま配信され続ける。R2が全オブジェクトに
`cache-control: max-age=14400`（＝4時間）を付けて返すため。URLを知っている人は
その間ダウンロードできてしまうので、削除時にアプリからCloudflareへ
「このフォルダのキャッシュを捨てて」と依頼する（`lib/cachePurge.ts`）。

§7のR2トークンは**オブジェクト権限だけ**でキャッシュ操作ができないので、別に1本作る。

1. Cloudflareダッシュボード右上のアカウントメニュー → **My Profile** → **API Tokens**
   → **Create Token** → **Create Custom Token**
2. 名前は `xibit360-cache-purge` など
3. **Permissions**: `Zone` / `Cache Purge` / **Purge** の1行だけ
4. **Zone Resources**: `Include` / `Specific zone` / `xibit360.art`
5. 作成して表示されるトークン文字列をコピー（一度しか出ない）
6. **Zone ID** は `xibit360.art` の **Overview** ページ右下「API」欄にある

Vercelに追加（§7の5つに加えて）:

| 変数名 | 値 | 公開 |
|---|---|---|
| `CLOUDFLARE_ZONE_ID` | 上のZone ID | サーバーのみ |
| `CLOUDFLARE_PURGE_TOKEN` | 上のトークン | サーバーのみ |

- **設定・変更したら再デプロイする**。Vercelは環境変数の変更を稼働中のデプロイには
  反映しない（`NEXT_PUBLIC_`かどうかに関わらず、新しいデプロイから有効になる）
- **未設定でもアプリは normal に動く**。削除は今まで通り成功し、4時間の窓が残るだけ
- トークンは秘密情報。チャットに貼らない

**設定したら必ず動作確認する**（キャッシュは黙って効くので、壊れていても気づけない）:

1. 本番で適当な作品を1つ開き、画像URL（`https://cdn.xibit360.art/…/display.jpg`）を控える
2. そのURLを2〜3回ブラウザで開く（エッジにキャッシュを載せるため）
3. `/me` からその作品を削除する
4. 控えたURLをシークレットウィンドウで開く → **404になればパージが効いている**。
   200のまま（`cf-cache-status: HIT`）なら効いていないので、トークンの権限とZone IDを見直す

> 無料プランのパージは**アカウントあたり毎分5回**まで。手作業の削除では当たらないが、
> 一度に大量削除するとあふれる。あふれたぶんは従来どおり4時間で自然に消える
> （削除自体は必ず成功する）。

## 8. 既存ファイルを移送する

まず件数と容量を空振りで確認:

```bash
node --env-file=.env.local scripts/migrate-storage-to-r2.mjs --dry-run
```

問題なければ実行:

```bash
node --env-file=.env.local scripts/migrate-storage-to-r2.mjs
```

- キーはそのまま維持されるので、DB側の `artworks.storage_path` は変更不要
- 再実行しても、すでにコピー済み（同じサイズ）のファイルは飛ばすので安全。途中で
  失敗したら再実行するだけでよい
- Supabase側は消さない。確認が済んでから§11で消す
- 移送中に誰かが新規アップロードすると取り残される可能性がある。利用者が増える前の
  今のうちにやるのが安全（気になる場合は深夜など静かな時間に）

## 9. DBの絶対URLを書き換える

作品画像は相対キーで保存されているので自動追従するが、アバター・ロゴ・BGM・音声ガイド・
LP画像・記事カバーはDBに絶対URLで入っているため書き換えが必要。

Supabase SQL Editor に `supabase/migrations/0029_r2_urls.sql` を貼って Run。
ファイル末尾の確認クエリが全部0件になればOK。再実行は安全。

## 10. デプロイして確認

デプロイ後、以下を手で確認する（この部分は自動テストがないので目視が必要）。

> **必ずシークレットウィンドウで確認する。** 移行前に取得した画像がブラウザキャッシュに
> 残っていると、コードが正しくても表示されない（理由は下の「よくある落とし穴」参照）。
> ⌘Shift+R では不十分 — 3Dが後からJSで取りに行く画像はキャッシュを使う。

- [ ] 公開ギャラリーで作品画像が表示される（画像URLが `cdn.xibit360.art` になっている）
- [ ] ブラウザのコンソールにCORSエラーが出ていない（出たら§5を見直す）
- [ ] 新しい画像作品をアップロードできる
- [ ] 動画作品をアップロードできる（Vercelの4.5MB制限を越える大きめのファイルで試す）
- [ ] プロフィール画像を差し替えられる
- [ ] 作品を削除するとファイルも消える
- [ ] 「読み上げ」（TTS）が再生できる
- [ ] 無料枠（300MB）を超えるアップロードがエラーメッセージで止まる

## 11. Supabase Storageを空にする

§10がすべて通り、数日運用して問題がなければ、Supabaseダッシュボード → Storage →
`artworks` バケットの中身を削除する。以後Supabaseの課金はDBと認証のぶんだけになる。

---

## 設計メモ（仕組みの要点）

- **アップロードは署名付きURL方式**。ブラウザは `/api/upload-url` に「これをこのサイズで
  上げたい」と申告し、サーバーが一時URLを署名して返す。ファイル本体はサーバーを通らない
  ため、Vercelのリクエスト上限4.5MBに縛られず40MBの動画も通る
- **保存先パスはサーバーが決める**。以前はSupabaseのRLSポリシーが「自分のフォルダしか
  書けない」を担保していた。R2に同等機能はないので、サーバーがトークンからuidを取り出して
  `{uid}/…` を組み立てる。クライアントの言い値のパスは一切使わない
- **容量制限もサーバー側**。以前はブラウザ側チェックのみで迂回可能だった
- **アカウント削除は `/api/account/delete`**。DB行を消すとユーザーが消えて後続リクエストを
  認証できなくなるため、削除とファイル一括削除を1リクエスト内で行う

---

## よくある落とし穴（実際に踏んだもの）

### 作品が「空の額縁」になる（2Dサムネイルは出るのに3Dで出ない）

**CORSの設定漏れではなく、`<img>` 側の指定漏れ**の可能性が高い。

R2は `Origin` ヘッダが付いたリクエストにしか `Access-Control-Allow-Origin` を返さない
（Supabase Storageは無条件に返していた）。さらにOriginなしの応答には `Vary: Origin` も
付かないため、`crossOrigin` なしの `<img>` が先に取得した「CORSヘッダ無し」の応答が
ブラウザキャッシュに残り、後続のWebGLテクスチャ用リクエスト（three.jsは既定で
`crossOrigin='anonymous'`）がそれを再利用して失敗する。

→ **R2の画像を表示する `<img>` には必ず `crossOrigin="anonymous"` を付ける**
（ルールは `lib/publicUrl.ts` 冒頭に明記。現状16箇所すべてに付与済み）。

すでに汚染されたキャッシュはコード修正では直らない。**シークレットウィンドウ**か
DevTools → Application → Storage → **Clear site data** で消す。

### 移行の検証で「配信できている」と誤判定しやすい

Cloudflareはエッジ（配信拠点）ごとにキャッシュを持つため、**すでに削除された
ファイルが200で返り続ける**ことがある（404も `max-age=14400` = 4時間キャッシュされる）。

→ 検証時は**必ずキャッシュバスター付きURLで `cf-cache-status: MISS` を確認する**か、
S3 APIで直接 `ListObjectsV2` してバケットの実体を見る。`cf-cache-status: HIT` の200は
「いま存在する」ことを証明しない。

### 削除した作品が最大4時間キャッシュから取得できる（対応済み）

DBとR2からは即座に消えるが、CloudflareのCDNキャッシュには残るため、URLを知っている人は
その間アクセスできた。**削除時にキャッシュパージAPIを呼ぶようにして解消済み**
（`lib/cachePurge.ts` / DECISIONS 2026-07-27）。§7.5のトークン設定が前提で、
**未設定だと黙って従来の4時間の窓に戻る**ので、設定と§7.5の動作確認を忘れないこと。

残る窓が1つある: **すでに閲覧者のブラウザにダウンロード済みのコピー**は、同じ
`max-age=14400` により最大4時間そのブラウザ内に残る。パージはCloudflare側の
キャッシュにしか効かない。ただしこれは「その人がすでに見た画像」であって、
URLを知る第三者が新たに取得できる経路ではない。
