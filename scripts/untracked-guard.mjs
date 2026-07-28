// 番人（check:css / check:i18n）が共有する「未追跡ファイル」ガード。
//
// 両方の番人は照合対象を `git ls-files` で集めている。つまり**新規ファイルは
// `git add` するまで検査対象に存在しない**。404ページを新設したとき、その
// 新規ファイルの中身がまるごと検査されず、`git add` した瞬間に検査ファイル数が
// 67→68 に増えて初めて正しい結果が出た（LESSONS 2026-07-28）。
// 「新規ファイルほど検出をすり抜ける」という逆転が起きるので、番人自身に
// 「見えていないファイルがある」と言わせる。
import { execSync } from 'node:child_process'

export const untracked = (matcher) =>
  execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter(matcher)

// 検査対象になりえる未追跡ファイルがあれば、検査結果は信用できないので落とす。
export const assertNoUntracked = (matcher, what) => {
  const list = untracked(matcher)
  if (!list.length) return
  console.error(`未追跡の${what}が ${list.length} 件あり、検査対象から漏れています:\n`)
  for (const f of list) console.error(`  ${f}`)
  console.error(`\nこの番人は git に登録されたものしか見ません（対象は git ls-files で集めています）。`)
  console.error(`新規ファイルほど検出をすり抜けるので、\`git add\` してから再実行してください。`)
  process.exit(1)
}
