'use client'
// 空間設定パネル(テーマ/レイアウト/額装の切替、アカウント、作品の出展)
// 出展先はログイン状態で切り替わる: ゲスト = localStorage / ログイン = Supabase
import { useRef, useState } from 'react'
import { THEMES, LAYOUTS, FRAMES } from '@/lib/presets'
import { overflowCount, useOwnArtworks } from '@/lib/exhibition'
import { useGallery, useSettings } from '@/lib/store'
import { fileToDataUrl, loadImage, newArtworkEntry } from '@/lib/upload'
import { supabase } from '@/lib/supabase'
import { uploadArtwork, deleteArtwork } from '@/lib/cloud'
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

function AccountSection() {
  const user = useGallery((s) => s.user)
  const signOut = useGallery((s) => s.signOut)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!supabase) {
    return <p className="settings-note">クラウド保存は未設定です(.env.local に Supabase のキーが必要)。</p>
  }

  if (user) {
    return (
      <>
        <p className="settings-note">
          <b>{user.email ?? user.displayName}</b> でログイン中。出展した作品はクラウドに保存され、
          どの端末からでも同じ展示になります。
        </p>
        <button className="btn-line" onClick={() => void signOut()}>ログアウト</button>
      </>
    )
  }

  async function sendMagicLink() {
    if (!email.trim() || busy) return
    setBusy(true)
    try {
      const { error } = await supabase!.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${location.origin}/demo` },
      })
      if (error) throw error
      setSent(true)
    } catch (e) {
      alert(`ログインリンクを送れませんでした: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  async function googleLogin() {
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/demo` },
    })
    if (error) alert(`Googleログインを開始できませんでした: ${error.message}`)
  }

  return (
    <>
      <div className="field-row">
        <input
          type="email"
          placeholder="メールアドレス"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void sendMagicLink()}
        />
        <button className="btn-line" disabled={busy} onClick={() => void sendMagicLink()}>
          リンク送信
        </button>
      </div>
      {sent && <p className="settings-note">ログインリンクを送りました。メールを確認してください。</p>}
      <div className="field-row">
        <button className="btn-line" onClick={() => void googleLogin()}>Google でログイン</button>
      </div>
      <p className="settings-note">
        ログインすると出展作品がクラウドに保存され、URL公開(開発中)の対象になります。
        未ログインでも出展はこのブラウザ内で試せます。
      </p>
    </>
  )
}

export default function SettingsPanel() {
  const open = useGallery((s) => s.settingsOpen)
  const setOpen = useGallery((s) => s.setSettingsOpen)
  const updateSettings = useGallery((s) => s.updateSettings)
  const user = useGallery((s) => s.user)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const settings = useSettings()
  const ownArtworks = useOwnArtworks()

  const [igNote, setIgNote] = useState(false)
  const [uploading, setUploading] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null!)
  const artistRef = useRef<HTMLInputElement>(null!)
  const urlRef = useRef<HTMLInputElement>(null!)

  async function addEntries(entries: { title: string; dataUrl: string; w: number; h: number }[]) {
    if (user) {
      // クラウド出展(Storage + DB)
      setUploading(true)
      try {
        for (const e of entries) {
          await uploadArtwork({ ownerId: user.id, dataUrl: e.dataUrl, title: e.title, w: e.w, h: e.h })
        }
        await refreshCloud()
      } catch (e) {
        alert(
          `アップロードに失敗しました: ${e instanceof Error ? e.message : e}\n` +
            'supabase/migrations/0001_init.sql を適用済みか確認してください。'
        )
      } finally {
        setUploading(false)
      }
    } else {
      // ゲスト出展(localStorage)
      const artist = artistRef.current.value.trim()
      const items: ArtworkData[] = entries.map((e) =>
        newArtworkEntry({ title: e.title, artist, src: e.dataUrl, w: e.w, h: e.h })
      )
      updateSettings({ artworks: [...settings.artworks, ...items] })
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    const entries = []
    for (const file of Array.from(files)) {
      try {
        const { dataUrl, w, h } = await fileToDataUrl(file, 1600)
        const title = titleRef.current.value.trim() || file.name.replace(/\.[^.]+$/, '') || '無題'
        entries.push({ title, dataUrl, w, h })
      } catch {
        alert(`「${file.name}」を読み込めませんでした。`)
      }
    }
    titleRef.current.value = ''
    if (entries.length) await addEntries(entries)
  }

  async function onAddUrl() {
    const url = urlRef.current.value.trim()
    if (!url) return
    try {
      // WebGLテクスチャにはCORS許可が必要なので、ここで検証を兼ねて読み込む
      const img = await loadImage(url, true)
      const title = titleRef.current.value.trim() || '無題'
      if (user) {
        // クラウドには自前でコピーを保存する(参照切れ防止)
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        c.getContext('2d')!.drawImage(img, 0, 0)
        await addEntries([{ title, dataUrl: c.toDataURL('image/jpeg', 0.9), w: img.width, h: img.height }])
      } else {
        updateSettings({
          artworks: [
            ...settings.artworks,
            newArtworkEntry({ title, artist: artistRef.current.value.trim(), src: url, w: img.width, h: img.height }),
          ],
        })
      }
      titleRef.current.value = ''
      urlRef.current.value = ''
    } catch {
      alert('画像を読み込めませんでした。配信元がCORSを許可していない可能性があります(その場合はアップロードをご利用ください)。')
    }
  }

  async function removeArtwork(art: ArtworkData) {
    if (user) {
      try {
        await deleteArtwork(user.id, art.id)
        await refreshCloud()
      } catch (e) {
        alert(`取り下げに失敗しました: ${e instanceof Error ? e.message : e}`)
      }
    } else {
      const overrides = { ...settings.frameOverrides }
      delete overrides[art.id]
      updateSettings({
        artworks: settings.artworks.filter((a) => a.id !== art.id),
        frameOverrides: overrides,
      })
    }
  }

  const over = overflowCount(settings, ownArtworks.length)
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
        <h3>アカウント</h3>
        <AccountSection />
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
          <input ref={artistRef} type="text" placeholder="作家名(省略可)" disabled={!!user} />
        </div>
        <label className="btn-line file-btn" aria-disabled={uploading}>
          {uploading ? 'アップロード中…' : '画像をアップロード'}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={uploading}
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
        {ownArtworks.length > 0 && (
          <ul className="my-works">
            {ownArtworks.map((art) => (
              <li key={art.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={art.src} alt="" />
                <span>{art.title}</span>
                <button aria-label={`${art.title} を取り下げる`} onClick={() => void removeArtwork(art)}>×</button>
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

      <p className="settings-note">
        空間の設定はこのブラウザに保存されます。出展作品は{user ? 'クラウド' : 'このブラウザ'}に保存されます。
      </p>
    </aside>
  )
}
