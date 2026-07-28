// prebuild フック: プレビュー(devサーバー)が動いているまま `npm run build` すると、
// 同じ .next を両方が触って `Cannot find module './331.js'` で全ページが白画面になる。
// 記録があっても急いでいると踏むため（LESSONS 2026-07-23 ×3）、機械で止める。
//
// 判定は .claude/launch.json のポートに接続できるかどうか。CI/Vercel では
// そもそも動いていないが、無駄な待ちを作らないよう明示的に飛ばす。
import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'

if (process.env.CI || process.env.VERCEL) process.exit(0)

const CONF = '.claude/launch.json'
if (!existsSync(CONF)) process.exit(0)

let ports = []
try {
  const conf = JSON.parse(readFileSync(CONF, 'utf8'))
  ports = (conf.configurations ?? []).map((c) => c.port).filter((p) => Number.isInteger(p))
} catch {
  process.exit(0) // 設定が読めないことを理由にビルドを止める必要はない
}

const inUse = (port) =>
  new Promise((res) => {
    const s = createConnection({ host: '127.0.0.1', port })
    const done = (v) => { s.destroy(); res(v) }
    s.setTimeout(400)
    s.on('connect', () => done(port))
    s.on('timeout', () => done(null))
    s.on('error', () => done(null))
  })

const busy = (await Promise.all(ports.map(inUse))).filter(Boolean)

if (busy.length) {
  console.error(`\nプレビュー(devサーバー)が動いたままです: ポート ${busy.join(', ')}`)
  console.error('この状態で build すると .next を両方が触り、全ページが白画面になります。')
  console.error('次の順で進めてください:')
  console.error('  1. preview_stop でサーバーを止める（またはプロセスを終了する）')
  console.error('  2. rm -rf .next')
  console.error('  3. npm run build')
  console.error('\n意図的に無視する場合は SKIP_DEV_SERVER_CHECK=1 を付けてください。')
  if (!process.env.SKIP_DEV_SERVER_CHECK) process.exit(1)
}
