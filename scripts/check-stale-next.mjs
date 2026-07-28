// predev フック: `npm run build` の直後に同じ作業ツリーで dev を起動すると、
// devサーバーが本番ビルドの .next を引き継いで**古いCSS/JSを配信する**。
// prebuild ガードが守るのは「dev → build」の順だけで、この逆順は素通りしていた。
//
// 逆順が厄介なのは、壊れ方が静かなこと（LESSONS 2026-07-28）:
// 実際に app/gallery.css へ足したルールが配信CSSに存在せず、
// getBoundingClientRect は新レイアウトを返すのにスクリーンショットは旧レイアウト、
// という「測定結果が自己矛盾する」状態になり、原因究明に時間を溶かした。
//
// 判定は .next に本番ビルドの成果物（BUILD_ID）があるかどうか。dev は BUILD_ID を
// 作らないので、これがあれば「直前に build した .next が残っている」と分かる。
// 消してから dev を起動する（dev は必要なものを作り直すので、消す副作用は無い）。
import { existsSync, rmSync } from 'node:fs'

if (process.env.CI || process.env.VERCEL) process.exit(0)

const BUILD_ID = '.next/BUILD_ID'
if (!existsSync(BUILD_ID)) process.exit(0)

if (process.env.KEEP_STALE_NEXT) {
  console.warn('\n.next に本番ビルドの成果物が残っていますが、KEEP_STALE_NEXT により残します。')
  console.warn('配信されるCSS/JSが編集内容より古い可能性があります。\n')
  process.exit(0)
}

console.log('\n.next に本番ビルド(`next build`)の成果物が残っています。')
console.log('そのまま dev を起動すると古いCSS/JSが配信され、実測とスクリーンショットが食い違います。')
console.log('.next を削除してから dev を起動します（残したい場合は KEEP_STALE_NEXT=1）。\n')
rmSync('.next', { recursive: true, force: true })
