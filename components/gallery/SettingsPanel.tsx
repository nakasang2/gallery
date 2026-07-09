'use client'
// Space settings panel (theme/layout/framing switches, account, and exhibiting works)
// Where works are exhibited depends on sign-in state: guest = localStorage / signed in = Supabase
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { THEMES, LAYOUTS, FRAMES, HANGINGS, CAPTIONS, TEMPLATES } from '@/lib/presets'
import { overflowCount, slotCount, useOwnArtworks } from '@/lib/exhibition'
import { useGallery, useSettings } from '@/lib/store'
import { fileToDataUrl, loadImage, newArtworkEntry, videoFileMeta, VIDEO_MAX_BYTES } from '@/lib/upload'
import { supabase } from '@/lib/supabase'
import { uploadArtwork, uploadVideoArtwork, deleteArtwork } from '@/lib/cloud'
import { getProfile, saveProfile } from '@/lib/publish'
import { setGalleryPublic } from '@/lib/galleries'
import { walkRef } from '@/lib/controller'
import { ThemeSwatch, LayoutPlan, TemplateCard } from '@/components/SpacePreviews'
import type { ArtworkData } from '@/lib/artworks'

// Profile editor (display name + bio). The display name is also used as the artist name on labels
function ProfileEditor() {
  const user = useGallery((s) => s.user)!
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    getProfile(user.id)
      .then((p) => {
        if (!alive) return
        setDisplayName(p.displayName)
        setBio(p.bio)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user.id])

  async function save() {
    setBusy(true)
    try {
      await saveProfile(user.id, { displayName, bio })
      await refreshCloud() // Update the artist name on labels
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    } catch (e) {
      alert(`Could not save your profile: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="profile-edit">
      <div className="field-row">
        <input
          type="text"
          placeholder="Display name (artist name)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <div className="field-row">
        <textarea
          className="bio-input"
          placeholder="Bio / statement (optional)"
          rows={2}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
      </div>
      <button className="btn-line" disabled={busy} onClick={() => void save()}>
        {saved ? 'Saved' : 'Save profile'}
      </button>
    </div>
  )
}

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

  if (!supabase) {
    return <p className="settings-note">Cloud storage is not configured (Supabase keys required in .env.local).</p>
  }

  if (user) {
    return (
      <>
        <p className="settings-note">
          Signed in as <b>{user.email ?? user.displayName}</b>. Exhibited works are stored in the cloud,
          so your show looks the same on every device.
        </p>
        <ProfileEditor />
        <div className="field-row">
          <Link className="btn-line" href="/me">Dashboard</Link>
          <button className="btn-line" onClick={() => void signOut()}>Sign out</button>
        </div>
      </>
    )
  }

  // Signed out: password / magic link / Google all live on the dedicated auth pages
  return (
    <>
      <p className="settings-note">
        Sign in to store your works in the cloud and publish your gallery at a public URL.
        Without an account, you can still exhibit inside this browser.
      </p>
      <div className="field-row">
        <Link className="btn-line" href="/signin">Sign in</Link>
        <Link className="btn-line" href="/signup">Create account</Link>
      </div>
    </>
  )
}

// Publish: thin status + toggle. Title/URL/username management lives in the dashboard
function PublishSection() {
  const username = useGallery((s) => s.profileUsername)
  const myGallery = useGallery((s) => s.myGallery)
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const settings = useSettings()
  const ownArtworks = useOwnArtworks()

  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // The dashboard owns title / URL / creation — this panel is only a status + toggle,
  // so the two surfaces can never diverge (single source of truth: the gallery row)
  if (!myGallery) {
    return (
      <p className="settings-note">
        Create your hakoniwa from the <Link href="/me" style={{ color: 'var(--gold)' }}>dashboard</Link> first
        — then you can publish it from here.
      </p>
    )
  }

  // Single-hakoniwa plan: the shareable URL is just /@name (slug stays in the DB
  // for the multi-gallery future; /@name/[slug] keeps resolving too)
  const publicUrl =
    typeof window !== 'undefined' && username ? `${location.origin}/@${username}` : ''

  async function toggle(nextPublic: boolean) {
    setBusy(true)
    try {
      await setGalleryPublic(myGallery!, nextPublic, settings, ownArtworks)
      await refreshMyGallery()
    } catch (e) {
      alert(`Publishing failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="field-row">
        {myGallery.is_public ? (
          <button className="btn-line" disabled={busy} onClick={() => void toggle(false)}>
            Make private
          </button>
        ) : (
          <button
            className="btn-line"
            disabled={busy || ownArtworks.length === 0 || !username}
            onClick={() => void toggle(true)}
          >
            Open to the public
          </button>
        )}
      </div>
      {!username && (
        <p className="settings-note">
          Set a username in the <Link href="/me" style={{ color: 'var(--gold)' }}>dashboard</Link> first —
          it becomes part of your public URL.
        </p>
      )}
      {username && ownArtworks.length === 0 && !myGallery.is_public && (
        <p className="settings-note">Exhibit at least one work before publishing.</p>
      )}
      {myGallery.is_public && publicUrl && (
        <p className="settings-note">
          Live at:{' '}
          <a href={publicUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
            {publicUrl}
          </a>{' '}
          <button
            className="chip"
            onClick={() => {
              void navigator.clipboard.writeText(publicUrl).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy URL'}
          </button>
          <br />
          Your edits sync to this page automatically. Rename your exhibition in the{' '}
          <Link href="/me" style={{ color: 'var(--gold)' }}>dashboard</Link>.
        </p>
      )}
    </>
  )
}

export default function SettingsPanel() {
  const open = useGallery((s) => s.settingsOpen)
  const setOpen = useGallery((s) => s.setSettingsOpen)
  const updateSettings = useGallery((s) => s.updateSettings)
  const user = useGallery((s) => s.user)
  const myGallery = useGallery((s) => s.myGallery)
  const syncState = useGallery((s) => s.syncState)
  const retrySync = useGallery((s) => s.retrySync)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const settings = useSettings()
  const ownArtworks = useOwnArtworks()

  const [igNote, setIgNote] = useState(false)
  const [uploading, setUploading] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null!)
  const artistRef = useRef<HTMLInputElement>(null)
  const urlRef = useRef<HTMLInputElement>(null!)

  // Upload feedback: close the panel and glide to the freshly hung work so the
  // result is actually seen (the panel otherwise hides it)
  const slots = slotCount(settings)
  function revealNew(prevOwnCount: number) {
    if (prevOwnCount >= slots) return // it landed beyond the visible slots
    setOpen(false)
    walkRef.current?.focusExhibit(prevOwnCount)
  }

  async function addEntries(entries: { title: string; dataUrl: string; w: number; h: number }[]) {
    const prevCount = ownArtworks.length
    if (user) {
      // Cloud exhibit (Storage + DB)
      setUploading(true)
      try {
        for (const e of entries) {
          await uploadArtwork({ ownerId: user.id, dataUrl: e.dataUrl, title: e.title, w: e.w, h: e.h })
        }
        await refreshCloud()
        revealNew(prevCount)
      } catch (e) {
        console.error('upload failed (are supabase/migrations applied?):', e)
        alert(`Upload failed: ${e instanceof Error ? e.message : e}`)
      } finally {
        setUploading(false)
      }
    } else {
      // Guest exhibit (localStorage)
      const artist = artistRef.current?.value.trim() ?? ''
      const items: ArtworkData[] = entries.map((e) =>
        newArtworkEntry({ title: e.title, artist, src: e.dataUrl, w: e.w, h: e.h })
      )
      updateSettings({ artworks: [...settings.artworks, ...items] })
      revealNew(prevCount)
    }
  }

  async function onVideoFile(file: File, title: string) {
    // Videos are too large for localStorage, so cloud exhibit only
    if (!user) {
      alert('Exhibiting video works requires an account — see the Account section.')
      return
    }
    if (file.size > VIDEO_MAX_BYTES) {
      alert(`Videos are limited to ${Math.floor(VIDEO_MAX_BYTES / 1024 / 1024)}MB (“${file.name}” is ${Math.ceil(file.size / 1024 / 1024)}MB).`)
      return
    }
    const prevCount = ownArtworks.length
    setUploading(true)
    try {
      const meta = await videoFileMeta(file)
      await uploadVideoArtwork({
        ownerId: user.id,
        file,
        posterDataUrl: meta.posterDataUrl,
        title,
        w: meta.w,
        h: meta.h,
      })
      await refreshCloud()
      revealNew(prevCount)
    } catch (e) {
      console.error('video upload failed (is 0002_video.sql applied?):', e)
      alert(`Video upload failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setUploading(false)
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    const entries = []
    // A typed title only applies to a single file — multi-selects keep their filenames
    const customTitle = files.length === 1 ? titleRef.current.value.trim() : ''
    for (const file of Array.from(files)) {
      const title = customTitle || file.name.replace(/\.[^.]+$/, '') || 'Untitled'
      if (file.type.startsWith('video/')) {
        await onVideoFile(file, title)
        continue
      }
      try {
        const { dataUrl, w, h } = await fileToDataUrl(file, 1600)
        entries.push({ title, dataUrl, w, h })
      } catch {
        alert(`Could not read “${file.name}”.`)
      }
    }
    titleRef.current.value = ''
    if (entries.length) await addEntries(entries)
  }

  async function onAddUrl() {
    const url = urlRef.current.value.trim()
    if (!url) return
    try {
      // WebGL textures require CORS permission, so load here to validate at the same time
      const img = await loadImage(url, true)
      const title = titleRef.current.value.trim() || 'Untitled'
      if (user) {
        // Store our own copy in the cloud (to avoid broken references)
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        c.getContext('2d')!.drawImage(img, 0, 0)
        await addEntries([{ title, dataUrl: c.toDataURL('image/jpeg', 0.9), w: img.width, h: img.height }])
      } else {
        const prevCount = ownArtworks.length
        updateSettings({
          artworks: [
            ...settings.artworks,
            newArtworkEntry({
              title,
              artist: artistRef.current?.value.trim() ?? '',
              src: url,
              w: img.width,
              h: img.height,
            }),
          ],
        })
        revealNew(prevCount)
      }
      titleRef.current.value = ''
      urlRef.current.value = ''
    } catch {
      alert('Could not load the image. The host may not allow CORS — try uploading the file instead.')
    }
  }

  async function removeArtwork(art: ArtworkData) {
    if (user) {
      try {
        await deleteArtwork(user.id, art.id)
        await refreshCloud()
      } catch (e) {
        alert(`Could not remove the work: ${e instanceof Error ? e.message : e}`)
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

  const reorder = useGallery((s) => s.reorderOwnArtworks)

  const over = overflowCount(settings, ownArtworks.length)

  // Template/theme/global-frame picks reset per-work framing — never silently
  function confirmOverrideReset(): boolean {
    const n = Object.keys(settings.frameOverrides).length
    if (n === 0) return true
    return confirm(`This resets the custom framing on ${n} work${n === 1 ? '' : 's'}. Continue?`)
  }

  // Highlight a template only while every axis still matches its bundle
  const activeTemplate =
    Object.entries(TEMPLATES).find(
      ([, t]) =>
        t.theme === settings.theme &&
        t.layout === settings.layout &&
        t.frame === settings.frame &&
        t.hanging === settings.hanging &&
        t.caption === settings.caption
    )?.[0] ?? ''

  return (
    <aside id="settings" className={`settings${open ? ' open' : ''}`} aria-hidden={!open} inert={!open}>
      <button className="panel-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
      <h2 className="settings-title">
        Edit space
        {/* Cloud write-through status — edits to a public hakoniwa must never fail silently */}
        {user && myGallery && syncState !== 'idle' && (
          syncState === 'error' ? (
            <button className="sync-chip error" onClick={retrySync}>Sync failed — retry</button>
          ) : (
            <span className={`sync-chip ${syncState}`}>{syncState === 'saving' ? 'Saving…' : 'Saved'}</span>
          )
        )}
      </h2>

      {/* Hanging your own work is the point of the product — it comes first */}
      <section className="settings-section">
        <h3>Exhibit your work</h3>
        <button className="btn-line" onClick={() => setIgNote(!igNote)}>Pick from Instagram</button>
        {igNote && (
          <p className="settings-note">
            Official integration requires the Instagram Graph API (business/creator accounts), so this is a mock
            in the prototype. Use the upload or image URL below instead.
          </p>
        )}
        <div className="field-row">
          <input ref={titleRef} type="text" placeholder="Title (optional, single upload)" />
          {/* Signed-in users' artist name comes from their profile */}
          {!user && <input ref={artistRef} type="text" placeholder="Artist (optional)" />}
        </div>
        <label className="btn-line file-btn" aria-disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload image / video'}
          <input
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            multiple
            hidden
            disabled={uploading}
            onChange={(e) => {
              void onFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        <p className="settings-note">
          Videos (reels etc.) up to 40MB, account required. They loop in the room and become audible as you approach.
        </p>
        <div className="field-row">
          <input ref={urlRef} type="url" placeholder="Paste an image URL" />
          <button className="btn-line" onClick={() => void onAddUrl()}>Add</button>
        </div>
        {ownArtworks.length > 0 && (
          <>
            <p className="settings-note">Use ▲▼ to reorder your exhibited works (slots).</p>
            <ul className="my-works">
              {ownArtworks.map((art, i) => (
                <li key={art.id}>
                  <span className="works-no">{i + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={art.poster ?? art.src} alt="" />
                  <span className="works-title">{art.kind === 'video' ? `🎬 ${art.title}` : art.title}</span>
                  <button
                    className="works-move"
                    aria-label={`Move ${art.title} up`}
                    disabled={i === 0}
                    onClick={() => void reorder(i, i - 1)}
                  >
                    ▲
                  </button>
                  <button
                    className="works-move"
                    aria-label={`Move ${art.title} down`}
                    disabled={i === ownArtworks.length - 1}
                    onClick={() => void reorder(i, i + 1)}
                  >
                    ▼
                  </button>
                  <button aria-label={`Remove ${art.title}`} onClick={() => void removeArtwork(art)}>×</button>
                </li>
              ))}
            </ul>
          </>
        )}
        {over > 0 && (
          <p className="settings-note">
            This layout has {slots} slots — {over} work{over > 1 ? 's are' : ' is'} currently not shown.
            Change the layout or hide the demo works to free up space.
          </p>
        )}
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.showDemo}
            onChange={(e) => updateSettings({ showDemo: e.target.checked })}
          />
          Show the demo collection
        </label>
      </section>

      <section className="settings-section">
        <h3>Template</h3>
        {/* A template sets every axis below in one go — shown as pictures, not names */}
        <div className="tpl-grid">
          {Object.keys(TEMPLATES).map((key) => (
            <TemplateCard
              key={key}
              templateId={key}
              active={key === activeTemplate}
              onClick={() => {
                if (!confirmOverrideReset()) return
                const t = TEMPLATES[key]
                updateSettings({
                  theme: t.theme,
                  layout: t.layout,
                  frame: t.frame,
                  hanging: t.hanging,
                  caption: t.caption,
                  frameOverrides: {},
                })
              }}
            />
          ))}
        </div>
        <p className="settings-note">A curated starting point. Fine-tune any axis below afterwards.</p>
      </section>

      <section className="settings-section">
        <h3>Theme</h3>
        {/* Wall / floor / light colours shown right on the chip */}
        <div className="chips">
          {Object.entries(THEMES).map(([key, def]) => (
            <button
              key={key}
              className={`chip chip-visual${key === settings.theme ? ' active' : ''}`}
              onClick={() => {
                if (!confirmOverrideReset()) return
                updateSettings({ theme: key, ...def.recommends, frameOverrides: {} })
              }}
            >
              <ThemeSwatch themeKey={key} />
              {def.label}
            </button>
          ))}
        </div>
        <p className="settings-note">Switching theme applies its recommended framing; adjust below to taste.</p>
      </section>

      <section className="settings-section">
        <h3>Layout</h3>
        {/* Floor plans generated from the real layout data: room, hanging spots, benches */}
        <div className="chips">
          {Object.entries(LAYOUTS).map(([key, def]) => (
            <button
              key={key}
              className={`chip chip-visual${key === settings.layout ? ' active' : ''}`}
              onClick={() => updateSettings({ layout: key })}
            >
              <LayoutPlan layoutKey={key} className="chip-plan" />
              {def.label}
            </button>
          ))}
          <button
            className={`chip chip-visual${settings.layout === 'custom' ? ' active' : ''}`}
            onClick={() => updateSettings({ layout: 'custom' })}
          >
            <LayoutPlan layoutKey="custom" params={settings.layoutParams} className="chip-plan" />
            Custom
          </button>
        </div>
        {settings.layout === 'custom' && (
          <div className="custom-layout">
            <label className="slider-row">
              <span>Width {Math.round(settings.layoutParams.hw * 2)}m</span>
              <input
                type="range"
                min={8}
                max={18}
                step={0.5}
                value={settings.layoutParams.hw}
                onChange={(e) =>
                  updateSettings({ layoutParams: { ...settings.layoutParams, hw: Number(e.target.value) } })
                }
              />
            </label>
            <label className="slider-row">
              <span>Depth {Math.round(settings.layoutParams.hd * 2)}m</span>
              <input
                type="range"
                min={4}
                max={10}
                step={0.5}
                value={settings.layoutParams.hd}
                onChange={(e) =>
                  updateSettings({ layoutParams: { ...settings.layoutParams, hd: Number(e.target.value) } })
                }
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.layoutParams.island}
                onChange={(e) =>
                  updateSettings({ layoutParams: { ...settings.layoutParams, island: e.target.checked } })
                }
              />
              Centre wall (4 extra slots)
            </label>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h3>Framing — all works</h3>
        {/* Changing the overall framing also resets any per-work overrides */}
        <ChipRow
          defs={FRAMES}
          current={settings.frame}
          onPick={(frame) => {
            if (!confirmOverrideReset()) return
            updateSettings({ frame, frameOverrides: {} })
          }}
        />
        <p className="settings-note">To change a single work, open it and use the panel.</p>
      </section>

      <section className="settings-section">
        <h3>Hanging</h3>
        <ChipRow defs={HANGINGS} current={settings.hanging} onPick={(hanging) => updateSettings({ hanging })} />
      </section>

      <section className="settings-section">
        <h3>Caption</h3>
        <ChipRow defs={CAPTIONS} current={settings.caption} onPick={(caption) => updateSettings({ caption })} />
      </section>

      <section className="settings-section">
        <h3>Account</h3>
        <AccountSection />
      </section>

      {user && (
        <section className="settings-section">
          <h3>Publish</h3>
          <PublishSection />
        </section>
      )}

      <p className="settings-note">
        Space settings are saved in this browser. Exhibited works are stored {user ? 'in the cloud' : 'in this browser'}.
      </p>
    </aside>
  )
}
