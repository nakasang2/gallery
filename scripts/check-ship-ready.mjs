// push 直前の番人: 並行セッションが原因の手戻りを機械で止める（/kaizen 昇格 2026-07-29、×6）。
//
// このリポジトリは Claude Code のセッションが同時に4つ動くことがあり、`origin/main`
// は1日に何度も進む。実際に起きたこと（LESSONS「検証・ツール」）:
//   ×3 1回の ship の最中に origin/main が3回動き、rebase → 衝突解消 → 検証やり直し
//   ×2 同じ日にさらに2回動き、rebase 3回・検証3回やり直し
//      別セッションの未コミットファイル（lib/entitlements.ts）が同じ作業ツリーにあり
//      push 直前の tsc が3件のエラーで落ちた（自分の変更のせいだと誤解しかけた）
//      `git fetch` せず、古い base のまま「指示の前提が間違っている」とユーザーに誤報告
//      push し忘れた作業が、origin/main が3コミット進む間ずっと本番に出ていなかった
//      件名が `docs:` のコミットが決済まわりのコード90行を含んでいた
//
// 番人が止めるのは「そのまま push すると誰も検証していない組み合わせが本番に出る」
// 状態だけ。判断の材料になるが止めるほどではないものは警告として出す。
//
// 使い方: `npm run check:ship-ready`（ship スキルの push 直前ステップ）。
// 意図的に飛ばすときは SKIP_SHIP_READY=1。
import { execFileSync } from 'node:child_process'

if (process.env.CI || process.env.VERCEL) process.exit(0)

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const fail = []
const warn = []

// --- 1. base が動いていないか -------------------------------------------------
// fetch できない（オフライン等）ことを理由に push を止めても意味がないので、
// 失敗したら「確認できなかった」として警告に落とす。
const fetched = git('fetch', 'origin') !== null
if (!fetched) {
  warn.push('`git fetch origin` に失敗しました。base が動いていないかを確認できていません。')
} else {
  // origin/main が HEAD の祖先なら早送りできる＝自分の検証はこの base の上で有効。
  const ff = (() => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  if (!ff) {
    const behind = git('log', '--oneline', 'HEAD..origin/main') || ''
    fail.push(
      `origin/main が進んでいます（${behind.split('\n').filter(Boolean).length} コミット）:\n` +
        behind.split('\n').filter(Boolean).map((l) => `      ${l}`).join('\n') +
        '\n    → `git rebase origin/main` してから、**検証を頭からやり直す**。' +
        '\n      別セッションの変更と自分の変更が組み合わさった状態は、まだ誰も検証していません。' +
        '\n    → rebase 後は `git show --stat <相手のコミット>` で中身を見る。' +
        '\n      件名が `docs:` でもコードを含むことがあります（実際にあった）。',
    )
  }
}

// --- 2. この作業ツリーがクリーンか -------------------------------------------
// 別セッションが同じ作業ツリーで実装中だと、その未コミットファイルを巻き込んで
// tsc/build が落ちる（そして自分の変更のせいだと思ってしまう）。
const dirty = (git('status', '--porcelain') || '').split('\n').filter(Boolean)
if (dirty.length) {
  fail.push(
    `作業ツリーに未コミット/未追跡の変更が ${dirty.length} 件あります:\n` +
      dirty.slice(0, 12).map((l) => `      ${l}`).join('\n') +
      (dirty.length > 12 ? `\n      … 他 ${dirty.length - 12} 件` : '') +
      '\n    → 自分の変更ならコミットする。**心当たりがなければ別セッションの作業なので、' +
      '\n      勝手にコミットせずユーザーに確認する**（検証はコミット済みの HEAD に対して行う）。',
  )
}

// --- 3. 他の作業ツリー / メインチェックアウトの取り残し ----------------------
// push し忘れたコミットは、そのセッションが終わると誰にも見えなくなる。
// 自分のものではないので止めはしないが、存在は伝える。
const worktrees = (git('worktree', 'list', '--porcelain') || '')
  .split('\n\n')
  .map((block) => {
    const path = block.match(/^worktree (.+)$/m)?.[1]
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null
    return path ? { path, branch } : null
  })
  .filter(Boolean)

const MY_TOP = git('rev-parse', '--show-toplevel')
for (const wt of worktrees) {
  if (wt.path === MY_TOP) continue
  // そのブランチに、リモートのどこにも載っていないコミットがあるか
  if (!wt.branch) continue
  const unpushed = git('log', '--oneline', `origin/main..refs/heads/${wt.branch}`) || ''
  const n = unpushed.split('\n').filter(Boolean).length
  if (n > 0) {
    warn.push(
      `別の作業ツリーに未pushのコミットが ${n} 件あります（${wt.branch} @ ${wt.path}）:\n` +
        unpushed.split('\n').filter(Boolean).slice(0, 3).map((l) => `      ${l}`).join('\n') +
        '\n      → 別セッションのものなら勝手に push しない。作業中なら正常です。',
    )
  }
}

// --- 出力 --------------------------------------------------------------------
for (const w of warn) console.log(`⚠ ${w}`)
if (warn.length) console.log('')

if (fail.length) {
  console.error(`push 前の確認で ${fail.length} 件止めました:\n`)
  for (const f of fail) console.error(`  ✗ ${f}\n`)
  console.error('意図的に無視する場合は SKIP_SHIP_READY=1 を付けてください。')
  if (!process.env.SKIP_SHIP_READY) process.exit(1)
}

console.log(`push 前の確認: OK（base は早送り可能・作業ツリーはクリーン。作業ツリー ${worktrees.length} 個）`)
