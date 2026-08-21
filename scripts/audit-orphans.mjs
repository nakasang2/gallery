#!/usr/bin/env node
// 棚卸し（読み取り専用）: R2 にあるのに、DBのどの行からも辿れないファイルを数える。
//
// なぜ要るか: 容量制限は `prefixBytes('{uid}/')` ＝ R2 の実バイト数で決めている
// （docs/DECISIONS.md 2026-07-27）。行から辿れなくなったファイルは**作家のプラン枠を
// 永久に食い続けるのに、本人には見えず消す手段も無い**。2026-08-18 に部屋削除の経路は
// 塞いだが、それ以前に消された部屋の分と、migration 0062 のトリガ（招待の取り消し・
// 辞退で部屋の行がDBの中で消える。Postgres から R2 は触れない）の分は残る。
//
// **このスクリプトは何も消さない。** `DeleteObjectsCommand` を import していないので、
// 書き間違いで消すこともできない。消すかどうかは、この出力を見てから人が決める。
//
// 使い方:
//   node scripts/audit-orphans.mjs --self-test                        # 資格情報なしで判定を確かめる
//   node --env-file=.env.local scripts/audit-orphans.mjs
//   node --env-file=.env.local scripts/audit-orphans.mjs --uid=<uuid> # 1人ぶんだけ
//   node --env-file=.env.local scripts/audit-orphans.mjs --keys       # 孤児の鍵を全部並べる
//
// 必要な環境変数:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (全員の行を読むため)
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
import { createClient } from '@supabase/supabase-js'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`

/**
 * 鍵 → 分類を作る。**`orphan` 以外は消さない側に倒す**（形が想定外なら `unknown`）。
 *
 * 生きている集合を引数で受けるのは、資格情報なしで自己テストできるようにするため。
 * 番人が自分の検査範囲を取りこぼして「0件」が嘘になった事故が過去に4回あるので
 * （AGENTS.md 5.5）、この数字も合成した鍵で確かめられる形にしておく。
 *
 * @param liveFolders  `{uid}/{id}` の集合（作品の `storage_path` と部屋）
 * @param liveSiblings `{uid}/{部屋id}-` の集合（部屋のロゴはフォルダの兄弟）
 * @param liveLpKeys   `_shared/lp/...` の生きている鍵の集合（site_config の
 *                     保存済みURLから逆算。リリース前監査 #44・2026-08-21）
 */
export function makeClassifier({ liveFolders, liveSiblings, liveLpKeys = null }) {
  return (key) => {
    // 作家の枠に載らないもの。static は同梱資産、tts はサーバ側の音声キャッシュ。
    if (key.startsWith('static/') || key.startsWith('tts/')) return { kind: 'system' }

    // LP画像は#41（2026-08-21）で口座の外（`_shared/lp/`）へ移した。口座を持たない
    // ので孤児判定を`account`として素通りさせる理由が無くなり、site_config の
    // 現在値と比較できる（枠の差し替え・クリアで残ったファイルを実際に検出する）。
    // `liveLpKeys` が無い（比較材料が無い）ときは、消してよいかもと言えないので
    // `unknown` に倒す — 判定できないものを orphan と言うのが最も危ない誤り。
    if (key.startsWith('_shared/lp/')) {
      if (!liveLpKeys) return { kind: 'unknown' }
      return { kind: liveLpKeys.has(key) ? 'live' : 'orphan', why: 'lp' }
    }

    const slash = key.indexOf('/')
    if (slash < 0) return { kind: 'unknown' }
    const uid = key.slice(0, slash)
    const rest = key.slice(slash + 1)
    if (!UUID.test(uid)) return { kind: 'unknown' }

    // 口座そのものに紐づくもの。行から辿る対象ではないので孤児判定にかけない。
    // **旧レイアウト（#41移行前）の名残だけがここに来る** — 新規のLP画像は
    // 上の`_shared/lp/`分岐で判定される。`scripts/migrate-lp-images-to-shared.mjs`
    // で移行が済めば、ここに残るのは移行し忘れた分だけになる。
    if (rest === 'avatar.jpg' || rest.startsWith('lp/')) return { kind: 'account', uid }

    // `{uid}/{id}/…` ── 作品のファイル、部屋のBGM、焼き込みアトラス。
    const inner = rest.indexOf('/')
    if (inner > 0) {
      const id = rest.slice(0, inner)
      if (!UUID.test(id)) return { kind: 'unknown', uid }
      const live = liveFolders.has(`${uid}/${id}`)
      return { kind: live ? 'live' : 'orphan', uid, id, why: 'folder' }
    }

    // `{uid}/{部屋id}-logo.jpg` ── フォルダの兄弟。
    const m = rest.match(/^([0-9a-f-]{36})-/)
    if (m && UUID.test(m[1])) {
      const live = liveSiblings.has(`${uid}/${m[1]}-`)
      return { kind: live ? 'live' : 'orphan', uid, id: m[1], why: 'sibling' }
    }

    return { kind: 'unknown', uid }
  }
}

/* ============================ 自己テスト ============================ */
// 「孤児0件」が嘘になっていないか、合成した鍵で確かめる。生きているものを
// orphan と呼ぶ誤りと、孤児を live と呼ぶ誤りの**両方向**を見る。
function selfTest() {
  const U = '11111111-1111-1111-1111-111111111111' // 作家
  const V = '22222222-2222-2222-2222-222222222222' // 別の作家
  const ART = 'aaaaaaaa-0000-0000-0000-00000000000a' // 生きている作品
  const ROOM = 'bbbbbbbb-0000-0000-0000-00000000000b' // 生きている部屋
  const DEAD = 'cccccccc-0000-0000-0000-00000000000c' // 消えた部屋
  const LP_LIVE = '_shared/lp/0-dddddddd-0000-0000-0000-00000000000d.jpg'
  const LP_DEAD = '_shared/lp/0-eeeeeeee-0000-0000-0000-00000000000e.jpg'
  const classify = makeClassifier({
    liveFolders: new Set([`${U}/${ART}`, `${U}/${ROOM}`]),
    liveSiblings: new Set([`${U}/${ROOM}-`]),
    liveLpKeys: new Set([LP_LIVE]),
  })

  const cases = [
    [`${U}/${ART}/display.jpg`, 'live', '生きている作品の画像'],
    [`${U}/${ART}/video`, 'live', '生きている作品の動画'],
    [`${U}/${ROOM}/bgm`, 'live', '生きている部屋のBGM'],
    [`${U}/${ROOM}/bake-0.png`, 'live', '生きている部屋の焼き込み'],
    [`${U}/${ROOM}-logo.jpg`, 'live', '生きている部屋のロゴ'],
    [`${U}/${DEAD}/bgm`, 'orphan', '消えた部屋のBGM'],
    [`${U}/${DEAD}/bake-0.png`, 'orphan', '消えた部屋の焼き込み'],
    [`${U}/${DEAD}-logo.jpg`, 'orphan', '消えた部屋のロゴ'],
    [`${V}/${ART}/display.jpg`, 'orphan', '同じidでも別の作家の下なら辿れない'],
    [`${V}/${ROOM}-logo.jpg`, 'orphan', 'ロゴも作家ごとに見る'],
    [`${U}/avatar.jpg`, 'account', 'アバターは行から辿る対象ではない'],
    [`${U}/lp/0.jpg`, 'account', '旧レイアウトのLP画像（#41移行前の名残）も同じ'],
    [LP_LIVE, 'live', '新レイアウトのLP画像・site_configが指す現在の1枚'],
    [LP_DEAD, 'orphan', '新レイアウトのLP画像・枠の差し替えで参照が外れたもの'],
    ['static/v1/models/visitor.glb', 'system', '同梱資産'],
    ['tts/abc123.mp3', 'system', '音声キャッシュ'],
    [`${U}/${ROOM}`, 'unknown', 'フォルダでも兄弟でもない裸のid'],
    [`${U}/notauuid/x.jpg`, 'unknown', 'uuidでない中間セグメント'],
    ['loose-file.txt', 'unknown', 'uidの下に無いもの'],
    [`${U}/${ROOM}-logo.jpg/extra`, 'unknown', '想定外の入れ子は live とも orphan とも言わない'],
  ]

  let fail = 0
  for (const [key, want, why] of cases) {
    const got = classify(key).kind
    const ok = got === want
    if (!ok) fail++
    console.log(`${ok ? '✓' : '✗'} ${want.padEnd(7)} ${why}${ok ? '' : ` — 実際は ${got}`}`)
  }
  console.log(`\n判定の自己テスト: ${cases.length - fail}/${cases.length} 通過`)
  return fail === 0
}

if (process.argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)

/* ============================== 本体 ============================== */
const need = (name) => {
  const v = process.env[name]
  if (!v) {
    console.error(`環境変数がありません: ${name}`)
    process.exit(1)
  }
  return v
}

const onlyUid = (process.argv.find((a) => a.startsWith('--uid=')) ?? '').slice('--uid='.length)
const showKeys = process.argv.includes('--keys')

const db = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})
const bucket = need('R2_BUCKET')
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: need('R2_ACCESS_KEY_ID'),
    secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
  },
})

/** 行を全部引く。PostgREST の既定は1000件で黙って切れるので、明示的にページングする
 *  ── ここで切れると**生きている作品が孤児に見える**（最も危ない誤り）。
 *  **`order` を指定しないページングは順序が保証されない**（リリース前監査 #43・
 *  2026-08-21）── ページの間に別のリクエストが行を書き換えると、Postgresは
 *  同じ並びを返す義理が無く、境界をまたぐ行が二重に来たり1件も来ないことがある。
 *  `id` は全テーブルの主キーで一意なので、これで安定した順序が決まる。 */
async function all(table, cols, orderCol = 'id') {
  const PAGE = 1000
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(cols).order(orderCol, { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table} の読み出しに失敗: ${error.message}`)
    out.push(...data)
    if (data.length < PAGE) return out
  }
}

async function* bucketKeys(prefix) {
  let token
  do {
    const page = await r2.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    )
    for (const o of page.Contents ?? []) if (o.Key) yield { key: o.Key, size: o.Size ?? 0 }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
}

const artworks = await all('artworks', 'id, owner_id, storage_path')
const galleries = await all('galleries', 'id, owner_id')
const profiles = await all('profiles', 'id')

// 「生きているフォルダ」は、行が主張しているパスをそのまま使う。作品は
// `storage_path`（= `{owner_id}/{artwork_id}`）が正で、uid と id から組み立て直すと
// 形の違う legacy 行を孤児と誤認する。部屋は列を持たないので組み立てる。
const liveFolders = new Set([
  ...artworks.map((a) => a.storage_path),
  ...galleries.map((g) => `${g.owner_id}/${g.id}`),
])
const liveSiblings = new Set(galleries.map((g) => `${g.owner_id}/${g.id}-`))
const knownUsers = new Set(profiles.map((p) => p.id))

// 生きているLP画像（`_shared/lp/...`）は、テーブルの行ではなく site_config の
// 保存済みURLだけが「これが今表示されている」と言える（リリース前監査 #44）。
const LP_BANDS = ['lp_hero', 'lp_panels', 'lp_approach', 'lp_hall_front', 'lp_hall_sides']
const publicBase = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE ?? '').replace(/\/+$/, '')
let liveLpKeys = null
if (publicBase) {
  liveLpKeys = new Set()
  let sawAnySlot = false
  const siteConfig = await all('site_config', 'key, value', 'key')
  for (const row of siteConfig) {
    if (!LP_BANDS.includes(row.key)) continue
    for (const slot of row.value?.slots ?? []) {
      if (!slot?.url) continue
      sawAnySlot = true
      if (slot.url.startsWith(publicBase)) liveLpKeys.add(slot.url.slice(publicBase.length).replace(/^\/+/, ''))
    }
  }
  // `startsWith` は NEXT_PUBLIC_R2_PUBLIC_BASE が保存済みURLの基点と一字一句
  // 揃っていることに賭けている（別視点レビューで発見・2026-08-21）。CDNの別名・
  // http/https・レガシーなカスタムドメイン等でズレていると、埋まっている枠が
  // あるのに1件もマッチせず liveLpKeys が空になり、**それに気づかず** 全ての
  // `_shared/lp/*` を「孤児」と自信満々に報告してしまう ── このスクリプトが
  // 最も避けたい誤り（生きているものを孤児と呼ぶ）そのもの。埋まっている枠が
  // 1つでもあるのに1つもマッチしなければ、比較材料が信用できないと判断して
  // unknown に倒す。
  if (sawAnySlot && liveLpKeys.size === 0) {
    console.warn(
      'LPの枠は埋まっているのに、どの保存済みURLもNEXT_PUBLIC_R2_PUBLIC_BASEと一致しませんでした。' +
        '基点がズレている疑いがあるため、LP画像（_shared/lp/）は孤児と判定せず unknown 扱いにします。'
    )
    liveLpKeys = null
  }
} else {
  console.warn('NEXT_PUBLIC_R2_PUBLIC_BASE が無いので、LP画像（_shared/lp/）は unknown 扱いになります。')
}
const classify = makeClassifier({ liveFolders, liveSiblings, liveLpKeys })

const tally = new Map() // uid → { live, orphan, account, unknown, keys[] }
const bytes = { live: 0, orphan: 0, account: 0, system: 0, unknown: 0 }
const counts = { live: 0, orphan: 0, account: 0, system: 0, unknown: 0 }
const unknownKeys = []

for await (const { key, size } of bucketKeys(onlyUid ? `${onlyUid}/` : '')) {
  const c = classify(key)
  bytes[c.kind] += size
  counts[c.kind] += 1
  if (c.kind === 'unknown') unknownKeys.push(key)
  if (!c.uid) continue
  const row = tally.get(c.uid) ?? { live: 0, orphan: 0, account: 0, unknown: 0, keys: [] }
  row[c.kind] += size
  if (c.kind === 'orphan') row.keys.push({ key, size, why: c.why })
  tally.set(c.uid, row)
}

const QUOTA = 300 * 1024 * 1024 // lib/limits の PLAN.storageBytes。表示のためだけに使う
const offenders = [...tally.entries()]
  .filter(([, v]) => v.orphan > 0)
  .sort((a, b) => b[1].orphan - a[1].orphan)

console.log(`\nバケット: ${bucket}${onlyUid ? `（${onlyUid} だけ）` : ''}`)
console.log(`DBの行: 作品 ${artworks.length} / 部屋 ${galleries.length} / 口座 ${profiles.length}\n`)
console.log(`  生きている  ${counts.live} 本 / ${mb(bytes.live)}`)
console.log(`  口座のもの  ${counts.account} 本 / ${mb(bytes.account)}（アバター・LP画像）`)
console.log(`  システム    ${counts.system} 本 / ${mb(bytes.system)}（static/ と tts/。作家の枠には載らない）`)
console.log(`  ★ 孤児      ${counts.orphan} 本 / ${mb(bytes.orphan)}`)
console.log(`  判定できず  ${counts.unknown} 本 / ${mb(bytes.unknown)}（消す判断をしてはいけない）\n`)

if (offenders.length) {
  console.log(`孤児を抱えている口座: ${offenders.length} 件（枠は1人 ${mb(QUOTA)}）`)
  for (const [uid, v] of offenders) {
    const gone = knownUsers.has(uid) ? '' : '  ← profiles に行が無い（口座ごと消えた疑い）'
    const pct = Math.round((v.orphan / QUOTA) * 100)
    console.log(`  ${uid}  孤児 ${mb(v.orphan)}（枠の ${pct}%）/ 生きている ${mb(v.live)}${gone}`)
    if (showKeys) for (const k of v.keys) console.log(`      ${k.key}  ${mb(k.size)}  [${k.why}]`)
  }
  if (!showKeys) console.log('\n  鍵を全部見るには --keys を付けてください。')
} else {
  console.log('孤児は見つかりませんでした。')
}

if (unknownKeys.length) {
  console.log(`\n判定できなかった鍵（${unknownKeys.length} 本）── 形が想定外なので手で見ること:`)
  for (const k of unknownKeys.slice(0, 50)) console.log(`  ${k}`)
  if (unknownKeys.length > 50) console.log(`  …ほか ${unknownKeys.length - 50} 本`)
}
console.log('\n※このスクリプトは何も消していません。')
