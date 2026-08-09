#!/usr/bin/env node
// 未適用の migration を1枚に束ねる。
//
//   npm run sql:pending -- 0036        # 0036 以降を全部
//   npm run sql:pending -- 0036 0042   # 範囲を切る
//
// なぜスクリプトなのか: 「未適用ぶんをまとめた pending.sql」を**ファイルとして
// リポジトリに置くと、次の migration を足した日に黙って古くなる**（そして古い方を
// 本番に貼る事故が起きる）。番号から毎回組み立てれば、その瞬間の正しい中身になる。
//
// 出力は SQL Editor に丸ごと貼れる1枚。番号順・冪等（各 migration が冪等な前提）。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'
// `--out <path>` を先に抜き取る。**その値も一緒に取り除く** — 残さないと
// 位置引数に混ざって終了番号として読まれる（最初の版でそれを踏んだ）。
const argv = process.argv.slice(2)
const outIdx = argv.indexOf('--out')
const out = outIdx >= 0 ? argv[outIdx + 1] : null
if (outIdx >= 0) argv.splice(outIdx, 2)

const args = argv.filter((a) => !a.startsWith('-'))
const from = args[0]
const to = args[1] ?? '9999'

if (!from || !/^\d{4}$/.test(from)) {
  console.error('使い方: npm run sql:pending -- <開始番号4桁> [終了番号4桁] [--out ファイル]')
  console.error('例:     npm run sql:pending -- 0036')
  process.exit(2)
}

const files = readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .filter((f) => {
    const n = f.slice(0, 4)
    return n >= from && n <= to
  })

if (files.length === 0) {
  console.error(`${from}〜${to} に該当する migration がありません`)
  process.exit(1)
}

const head = `-- 未適用の migration をまとめたもの（${files[0].slice(0, 4)}〜${files[files.length - 1].slice(0, 4)}・${files.length}本）
--
-- ${new Date().toISOString().slice(0, 10)} に \`npm run sql:pending -- ${from}${args[1] ? ' ' + args[1] : ''}\` で生成。
-- **このファイルはリポジトリに置かない** — 次の migration を足した瞬間に古くなるため、
-- 必要なときに生成し直す。
--
-- 使い方: Supabase の SQL Editor に丸ごと貼って Run。番号順に並んでいるので1回で済む。
-- 各 migration は冪等なので、途中で失敗して貼り直しても安全。
--
-- 含まれるもの:
${files.map((f) => `--   ${f}`).join('\n')}

`

const body = files
  .map((f) => {
    const sql = readFileSync(join(DIR, f), 'utf8')
    return `\n/* ==========================================================================\n   ${f}\n   ========================================================================== */\n${sql}`
  })
  .join('\n')

const text = head + body
if (out) {
  writeFileSync(out, text)
  console.error(`${out} に書き出しました（${files.length}本・${text.split('\n').length} 行）`)
} else {
  process.stdout.write(text)
}
