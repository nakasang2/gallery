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
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  },
  {
    "AllowedOrigins": [
      "https://www.xibit360.art",
      "https://xibit360.art",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

- 読み取り（`GET`/`HEAD` = 表示）は **`*` で全オリジンに許可する**。理由は次項の
  「必ず読んでほしい落とし穴」を参照 — オリジンごとに違う返事をすると、CDNの
  キャッシュと噛み合わずに**特定の地域の人だけ作品が真っ黒になる**
- バケットは元々公開なので、`*` にしてもセキュリティは下がらない。おまけに
  **埋め込み（`?embed=1`）が設定追加なしでどのサイトからでも動く**
- 書き込み（`PUT` = アップロード）は自分のサイトだけに限定したまま。なお
  アップロードの宛先は `cdn.xibit360.art` ではなく S3 API エンドポイントなので、
  読み取り側を `*` にしてもアップロードの防御には影響しない
- `localhost:3000` はローカル開発用。不要なら消してよい

### 5.1 レスポンスヘッダのTransform Rule（**必須** — これが無いと再発する）

上のポリシーだけでは穴が残る。R2は**`Origin`ヘッダが付いたリクエストにしか**
`Access-Control-Allow-Origin` を返さない。検索エンジンのクローラー、SNSのOGP取得、
`curl` などは `Origin` を送らないので、**許可ヘッダが1つも無い返事**が返る。それが先に
CDNへキャッシュされると、以降そのURLは全員に許可ヘッダなしで配られ、2Dの `<img>` は
見えるのに**3Dのテクスチャだけ真っ黒**になる。

キャッシュの中身に関係なくヘッダを付けさせて塞ぐ:

1. Cloudflareダッシュボード → **Websites** → **`xibit360.art`** を選ぶ
   （R2の画面ではなく、**ドメインの画面**に入る）
2. 左メニュー **Rules** → **Overview**（または Transform Rules）
3. **Modify Response Header** の **Create rule**
   — **Request** ではなく **Response**。見出しが「You can modify up to 30 *response*
   headers」になっているか必ず確認する
4. 設定:
   - Rule name: `cdn always CORS`
   - **Custom filter expression** → Hostname **equals** `cdn.xibit360.art`
     （Expression Preview が `(http.host eq "cdn.xibit360.art")` になればOK）
   - **Set static** / Header name `Access-Control-Allow-Origin` / Value `*`
     — **`Add` ではなく `Set`**。`Add` だとR2が返すヘッダと二重になり、
     ブラウザは重複を理由に**全部拒否**する
5. **Deploy**

確認（`Origin` を付けずに叩いても `*` が返れば成功）:

```bash
curl -sI https://cdn.xibit360.art/<任意の作品キー>/display.jpg | grep -i access-control
```

> Transform Rule は配信の出口で適用されるので、**すでに汚染されたキャッシュにも
> 効く**（`cf-cache-status: HIT` でもヘッダが付く）。

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
   200のまま（`cf-cache-status: HIT`）なら効いていない

効いていないときの切り分け（Vercelのログに `cache purge rejected` が出ているはず）:

- `Authentication error` 系 → トークンの権限（`Zone` / `Cache Purge` / `Purge`）とZone IDを見直す
- **プレフィックス自体が拒否される** → プレフィックス指定パージが使えないということなので、
  `lib/cachePurge.ts` をURL指定（`{ files: [...] }`）に切り替える。その場合は削除したキーの
  一覧が必要になるので、`deletePrefix`（`lib/r2.ts`）が消したキーを返すよう変更し、
  1リクエストにつき最大100件ずつに分割して送る。`?v=` 付きのURL（アバター/ロゴ/BGM）には
  届かなくなる点に注意

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

**続けて `supabase/migrations/0030_storage_reservations.sql` も Run する。**
容量制限（1人300MB）が「アップロード中のファイル」を数えるための予約テーブルを作る。
再実行は安全。

> 未適用でもアップロードは止まらない（実測値だけで判定する動作に自動で縮退し、
> サーバーログに `apply migration 0030` と警告が出る）。ただしその状態では、
> 同時に大量の署名要求を投げられたときだけ上限を一瞬すり抜けられる。

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
- [ ] 音声ガイド・BGMをアップロードできる
- [ ] `/me` の「Storage: N MB of 300 MB used」が、作品を上げると増え、消すと減る
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
- **容量制限もサーバー側、しかも「実測」**。以前はブラウザ側チェックのみで迂回可能だった。
  サーバーへ移した後も判定の材料が`artworks.bytes`（クライアントの言い値）だったため、
  行を作らずに上げ続ける・`bytes: 0`で挿入する・音声/BGMを上げる、のどれでも上限を
  無制限に超えられた。現在は**署名のたびにR2の`{uid}/`配下を実測**して判定するので、
  クライアントが何を申告しても数字は動かない（DECISIONS 2026-07-27「容量制限の実測化」）。
  アップロード中のファイルはまだR2に無いので、署名した分を`storage_reservations`に
  12分だけ積んで二重に数える。掃除のcronは不要で、期限切れ行は次の署名要求のついでに消える
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

**×2（2026-07-27・真因はもう一段深かった）**: 上の対策後も再発した。汚染されるのは
ブラウザキャッシュだけでなく **CloudflareのCDNキャッシュ**も同じで、しかもこちらの方が
たちが悪い。CDNは1つのURLに実質1つの返事しかキャッシュしないため、

- `Origin` なしのリクエスト（クローラー／OGP取得／`curl`）が先に来ると、
  **許可ヘッダ無しの返事**がキャッシュされ、以降**全員**が3Dで真っ黒になる
- 旧ポリシーのようにオリジンごとに違う許可（`www…` 宛 / apex 宛）を返していると、
  **www で入ったキャッシュが apex の人に配られて**やはり失敗する
- **キャッシュは配信拠点ごとに別**なので、**特定の地域の人だけ見えない**という
  極めて気づきにくい壊れ方をする（開発者の環境では正常に見えるので再現しない）

→ 恒久対策は **§5 の CORS を読み取り `*` にする**（返事を相手によって変えない）＋
**§5.1 の Transform Rule で許可ヘッダを無条件に付ける**（キャッシュに何が入っていても
出口で正しくなる）。切り分けは `Origin` の有無で叩き分けるのが速い:

```bash
U=https://cdn.xibit360.art/<キー>
curl -sI "$U" | grep -i access-control                                  # Originなし
curl -sI -H "Origin: https://www.xibit360.art" "$U" | grep -i access-control
```

**両方で `access-control-allow-origin: *` が返れば正常。** 片方でも欠けていたら、
そのURLはいつか誰かの画面で真っ黒になる。なお切り分け用の `curl` 自体が
`Origin` なしのリクエストなので、**素の `curl` は汚染側のキャッシュを作る**。
調査するときは `Origin` を付けて叩く。

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
