// prebuild フック: プレビュー(devサーバー)が動いているまま `npm run build` すると、
// 同じ .next を両方が触って `Cannot find module './331.js'` で全ページが白画面になる。
// 記録があっても急いでいると踏むため（LESSONS 2026-07-23 ×3）、機械で止める。
//
// 判定は .claude/launch.json のポートに接続できるかどうか。CI/Vercel では
// そもそも動いていないが、無駄な待ちを作らないよう明示的に飛ばす。
//
// ただしポートを見るだけでは worktree を区別できず、**別セッションがメイン
// チェックアウトで dev を動かしているだけで worktree 側の build が打てなくなる**
// （.next は別ディレクトリなので実際には衝突していない。LESSONS 2026-07-28 の副作用）。
// そこで listen しているプロセスの cwd を見て、**この作業ツリーの中で動いている
// dev だけ**を止める理由にする。cwd が取れない環境では従来どおりポートで止める
// （安全側）。
import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { execFileSync } from 'node:child_process'

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

const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
const topLevel = (cwd) => {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], quiet).trim()
  } catch {
    return null
  }
}

// この作業ツリーのルート。worktree は `<main>/.claude/worktrees/<name>` のように
// **メインチェックアウトの内側**に置かれるので、cwd の前方一致で判定すると
// 「worktree の dev が動いているだけでメイン側の build が止まる」という逆向きの
// 誤爆になる（レビューで実測。.next は別ディレクトリなので止める理由はない）。
// 作業ツリーのルート同士を比較する。
const MY_TOP = topLevel(process.cwd())

// そのポートを listen しているプロセスの cwd が、この作業ツリーのものかどうか。
// 判定できなければ null を返し、呼び出し側は「危ないので止める」に倒す。
const inThisTree = (port) => {
  if (!MY_TOP) return null
  try {
    const pids = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], quiet)
      .split('\n')
      .filter(Boolean)
    if (!pids.length) return null
    return pids.some((pid) => {
      const out = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], quiet)
      const cwd = out.split('\n').find((l) => l.startsWith('n'))?.slice(1)
      return !!cwd && topLevel(cwd) === MY_TOP
    })
  } catch {
    return null // lsof が無い/権限が無い環境では判定不能
  }
}

// 判定は1ポート1回だけ。2回呼ぶと、その間にサーバーが終了した場合に
// blocking と elsewhere の両方から漏れる（または両方に入る）。
const verdict = new Map(busy.map((p) => [p, inThisTree(p)]))
const blocking = busy.filter((p) => verdict.get(p) !== false)
const elsewhere = busy.filter((p) => verdict.get(p) === false)

if (elsewhere.length) {
  console.log(`ポート ${elsewhere.join(', ')} は別の作業ツリーの dev です（.next は別なので続行します）。`)
}

if (blocking.length) {
  console.error(`\nプレビュー(devサーバー)がこの作業ツリーで動いたままです: ポート ${blocking.join(', ')}`)
  console.error('この状態で build すると .next を両方が触り、全ページが白画面になります。')
  console.error('次の順で進めてください:')
  console.error('  1. preview_stop でサーバーを止める（またはプロセスを終了する）')
  console.error('  2. rm -rf .next')
  console.error('  3. npm run build')
  console.error('\n意図的に無視する場合は SKIP_DEV_SERVER_CHECK=1 を付けてください。')
  if (!process.env.SKIP_DEV_SERVER_CHECK) process.exit(1)
}
