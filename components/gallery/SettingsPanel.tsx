'use client'
// 空間設定パネル(テーマ/レイアウト/額装の切替と、作品の出展)
import { useRef, useState } from 'react'
import { THEMES, LAYOUTS, FRAMES } from '@/lib/presets'
import { overflowCount } from '@/lib/exhibition'
import { useGallery, useSettings } from '@/lib/store'
import { fileToDataUrl, loadImage, newArtworkEntry } from '@/lib/upload'
import type { ArtworkData } from '@/lib/artworks'

function ChipRow({
  defs,
  current,
  onPick,
}: {
  defs: Record<string, { label: string }>
  current: string
  onPick: (key: string) => void
}) {
  return (
    <div className="chips">
      {Object.entries(defs).map(([key, def]) => (
        <button key={key} className={`chip${key === current ? ' active' : ''}`} onClick={() => onPick(key)}>
          {def.label}
        </button>
      ))}
    </div>
  )
}

export default function SettingsPanel() {
  const open = useGallery((s) => s.settingsOpen)
  const setOpen = useGallery((s) => s.setSettingsOpen)
  const updateSettings = useGallery((s) => s.updateSettings)
  const settings = useSettings()

  const [igNote, setIgNote] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null!)
  const artistRef = useRef<HTMLInputElement>(null!)
  const urlRef = useRef<HTMLInputElement>(null!)

  function addArtworks(entries: ArtworkData[]) {
    updateSettings({ artworks: [...settings.artworks, ...entries] })
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    const entries: ArtworkData[] = []
    for (const file of Array.from(files)) {
      try {
        const { dataUrl, w, h } = await fileToDataUrl(file)
        const title = titleRef.current.value.trim() || file.name.replace(/\.[^.]+$/, '') || '無題'
        entries.push(newArtworkEntry({ title, artist: artistRef.current.value.trim(), src: dataUrl, w, h }))
      } catch {
        alert(`「${file.name}」を読み込めませんでした。`)
      }
    }
    titleRef.current.value = ''
    if (entries.length) addArtworks(entries)
  }

  async function onAddUrl() {
    const url = urlRef.current.value.trim()
    if (!url) return
    try {
      // WebGLテクスチャにはCORS許可が必要なので、ここで検証を兼ねて読み込む
      const img = await loadImage(url, true)
      const title = titleRef.current.value.trim() || '無題'
      titleRef.current.value = ''
      urlRef.current.value = ''
      addArtworks([newArtworkEntry({ title, artist: artistRef.current.value.trim(), src: url, w: img.width, h: img.height })])
    } catch {
      alert('画像を読み込めませんでした。配信元がCORSを許可していない可能性があります(その場合はアップロードをご利用ください)。')
    }
  }

  function removeArtwork(art: ArtworkData) {
    const overrides = { ...settings.frameOverrides }
    delete overrides[art.id]
    updateSettings({
      artworks: settings.artworks.filter((a) => a.id !== art.id),
      frameOverrides: overrides,
    })
  }

  const over = overflowCount(settings)
  const slots = LAYOUTS[settings.layout].slots.length

  return (
    <aside id="settings" className={`settings${open ? ' open' : ''}`} aria-hidden={!open}>
      <button className="panel-close" aria-label="閉じる" onClick={() => setOpen(false)}>×</button>
      <h2 className="settings-title">空間を編集</h2>

      <section className="settings-section">
        <h3>テーマ</h3>
        <ChipRow defs={THEMES} current={settings.theme} onPick={(theme) => updateSettings({ theme })} />
      </section>

      <section className="settings-section">
        <h3>レイアウト</h3>
        <ChipRow defs={LAYOUTS} current={settings.layout} onPick={(layout) => updateSettings({ layout })} />
      </section>

      <section className="settings-section">
        <h3>額装(全体)</h3>
        {/* 全体変更は作品ごとの指定もリセット */}
        <ChipRow defs={FRAMES} current={settings.frame} onPick={(frame) => updateSettings({ frame, frameOverrides: {} })} />
        <p className="settings-note">作品ごとに変えたいときは、作品を鑑賞中のパネルから。</p>
      </section>

      <section className="settings-section">
        <h3>作品を出展</h3>
        <button className="btn-line" onClick={() => setIgNote(!igNote)}>Instagram から選ぶ</button>
        {igNote && (
          <p className="settings-note">
            公式連携には Instagram Graph API(ビジネス/クリエイターアカウント)が必要なため、プロトタイプではモックです。
            下のアップロードか画像URLで出展できます。
          </p>
        )}
        <div className="field-row">
          <input ref={titleRef} type="text" placeholder="タイトル(省略可)" />
          <input ref={artistRef} type="text" placeholder="作家名(省略可)" />
        </div>
        <label className="btn-line file-btn">
          画像をアップロード
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void onFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        <div className="field-row">
          <input ref={urlRef} type="url" placeholder="画像URLを貼り付け" />
          <button className="btn-line" onClick={() => void onAddUrl()}>追加</button>
        </div>
        {settings.artworks.length > 0 && (
          <ul className="my-works">
            {settings.artworks.map((art) => (
              <li key={art.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={art.src} alt="" />
                <span>{art.title}</span>
                <button aria-label={`${art.title} を取り下げる`} onClick={() => removeArtwork(art)}>×</button>
              </li>
            ))}
          </ul>
        )}
        {over > 0 && (
          <p className="settings-note">
            このレイアウトの展示枠は{slots}点です。{over}点は表示されていません(レイアウト変更かデモ非表示で枠が空きます)。
          </p>
        )}
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.showDemo}
            onChange={(e) => updateSettings({ showDemo: e.target.checked })}
          />
          デモ作品も展示する
        </label>
      </section>

      <p className="settings-note">設定と出展作品はこのブラウザに保存されます(プロトタイプ)。</p>
    </aside>
  )
}
