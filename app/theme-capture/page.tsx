// テーマカードの写真（public/themes/*.jpg）を焼くための開発用ページ。
//
// なぜ画像なのか: テーマチップは「選ぶ前に見える」ためのもので、ユーザーが値を動かす
// 場所ではない（動かす場所＝Design Tools は隣の大プレビューが受け持つ）。固定の3枚なら
// 焼いておけば GPU を一切使わずに実写が出せる（ユーザー選択 2026-08-17）。
//
// 焼き直しが要るのは `lib/presets` の `THEMES` を変えたとき。`npm run check:theme-images`
// が定義のハッシュを見張っていて、ずれたら push 前に落ちる。手順はその番人が表示する。
import { notFound } from 'next/navigation'
import ThemeCapture from './ThemeCapture'

export default function ThemeCapturePage() {
  // 本番には出さない（開発用の道具で、来場者にも作家にも用は無い）
  if (process.env.NODE_ENV === 'production') notFound()
  return <ThemeCapture />
}
