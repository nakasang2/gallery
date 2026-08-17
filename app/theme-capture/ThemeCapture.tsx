'use client'
// テーマカードの写真を焼く画面。`/theme-capture`（開発時のみ）。
// 使い方: このページを開いて絵が出そろったら「3枚を保存」を押し、
// 落ちてきた `{key}.jpg` を `public/themes/` に置いて `npm run check:theme-images` を通す。
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { THEMES } from '@/lib/presets'
import { ARTWORKS } from '@/lib/artworks'
import { THEME_CARD_W, THEME_CARD_H } from '@/lib/themeCards'

const Preview3D = dynamic(() => import('@/components/Preview3D'), { ssr: false })

export default function ThemeCapture() {
  const art = ARTWORKS[0]
  const [note, setNote] = useState('')

  const grab = (key: string): string | null => {
    const canvas = document.querySelector<HTMLCanvasElement>(`#cap-${key} canvas`)
    if (!canvas) return null
    return canvas.toDataURL('image/jpeg', 0.9)
  }

  const saveAll = () => {
    const done: string[] = []
    for (const key of Object.keys(THEMES)) {
      const url = grab(key)
      // 空の絵（数KB）を掴んでいないか確かめる。preserveDrawingBuffer が効いていないと
      // ここに落ちる ── 気づかず真っ黒な写真をコミットするのがいちばん厄介なので止める。
      if (!url || url.length < 20000) {
        setNote(`${key} がまだ描けていません（取得 ${url ? url.length : 0} 文字）。少し待ってから押し直してください。`)
        return
      }
      const a = document.createElement('a')
      a.href = url
      a.download = `${key}.jpg`
      a.click()
      done.push(key)
    }
    setNote(`保存しました: ${done.join(' / ')} → public/themes/ に置いてください`)
  }

  return (
    <main style={{ padding: '2rem', background: '#0b0a09', minHeight: '100vh', color: '#ece7de' }}>
      <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.8rem' }}>テーマカードの写真を焼く（開発用）</h1>
      <p style={{ color: '#9a938a', fontSize: '0.82rem', margin: '0.6rem 0 1.2rem' }}>
        絵が出そろってから押してください。{THEME_CARD_W}×{THEME_CARD_H}px で焼きます。
      </p>
      <button onClick={saveAll} className="btn-line" style={{ marginBottom: '1.6rem' }}>
        {Object.keys(THEMES).length}枚を保存
      </button>
      {note && <p style={{ color: '#d4a24e', fontSize: '0.82rem', marginBottom: '1.2rem' }}>{note}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.4rem' }}>
        {Object.entries(THEMES).map(([key, def]) => (
          <div key={key}>
            <div style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#d4a24e', marginBottom: '0.4rem' }}>
              {def.label}
            </div>
            <div id={`cap-${key}`} style={{ width: THEME_CARD_W, height: THEME_CARD_H, overflow: 'hidden' }}>
              <Preview3D
                art={art}
                index={0}
                themeKey={key}
                frameKey={def.recommends.frame}
                matKey="auto"
                hangingKey={def.recommends.hanging}
                captionKey={def.recommends.caption}
                designOverrides={null}
                mode="room"
                preserveBuffer
              />
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
