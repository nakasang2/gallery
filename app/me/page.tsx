'use client'
// Dashboard: manage your hakoniwa (create / rename / publish / delete), profile, and links.
// Designed for multiple galleries; the release plan caps creation at PLAN.galleries.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useGallery } from '@/lib/store'
import { TEMPLATES, THEMES, LAYOUTS } from '@/lib/presets'
import { ThemeSwatch, LayoutPlan, TemplateCard } from '@/components/SpacePreviews'
import { PLAN } from '@/lib/limits'
import {
  listMyGalleries,
  createGallery,
  renameGallery,
  deleteGallery,
  setGalleryPublic,
  setGalleryCover,
  updateGallerySlug,
  saveGallerySpace,
  rebuildPlacements,
  rowToSettings,
  type GalleryRow,
} from '@/lib/galleries'
import { getProfile, saveProfile, setUsername, USERNAME_RE } from '@/lib/publish'
import {
  getStorageUsage,
  uploadArtwork,
  uploadAvatar,
  deleteArtwork,
  artworkPlacementCount,
  deleteMyAccount,
} from '@/lib/cloud'
import {
  engagementSummary,
  listGuestbook,
  deleteGuestbookEntry,
  type EngagementSummary,
  type GuestbookEntry,
} from '@/lib/engagement'
import { fileToDataUrl, loadImage } from '@/lib/upload'
import type { ArtworkData } from '@/lib/artworks'
import AuthShell from '@/components/auth/AuthShell'

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

const IMPORT_DISMISS_KEY = 'hakoniwa.importDismissed.v1'

// Guest migration (REQUIREMENTS 10.1): offer to move this browser's local works into the account
function GuestImportCard() {
  const user = useGallery((s) => s.user)!
  const localArtworks = useGallery((s) => s.artworks)
  const updateSettings = useGallery((s) => s.updateSettings)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(IMPORT_DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])

  if (dismissed || localArtworks.length === 0) return null

  function dismiss() {
    try {
      localStorage.setItem(IMPORT_DISMISS_KEY, '1')
    } catch {
      /* storage full — the card will simply reappear next visit */
    }
    setDismissed(true)
  }

  async function importAll() {
    setBusy(true)
    let ok = 0
    let failed = 0
    const remaining = [...localArtworks]
    for (const art of localArtworks) {
      try {
        let dataUrl = art.src
        if (!dataUrl) {
          failed++
          continue
        }
        if (!dataUrl.startsWith('data:')) {
          // URL-added works: fetch through a canvas (CORS permitting)
          const img = await loadImage(dataUrl, true)
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          c.getContext('2d')!.drawImage(img, 0, 0)
          dataUrl = c.toDataURL('image/jpeg', 0.9)
        }
        const [w, h] = art.ratio
        await uploadArtwork({ ownerId: user.id, dataUrl, title: art.title, w, h })
        remaining.splice(remaining.findIndex((a) => a.id === art.id), 1)
        ok++
      } catch (e) {
        console.error(`import failed for “${art.title}”:`, e)
        failed++
      }
    }
    updateSettings({ artworks: remaining })
    await refreshCloud()
    setBusy(false)
    // Full success: the card hides itself because the local list is empty — do NOT set the
    // dismiss flag, so works added as a guest later can still be imported
    if (failed) alert(`Imported ${ok} work${ok === 1 ? '' : 's'}; ${failed} could not be read (CORS or storage limit) and stayed local.`)
  }

  return (
    <div className="me-card" style={{ marginBottom: '1rem' }}>
      <p className="me-note" style={{ marginTop: 0 }}>
        You have <b>{localArtworks.length}</b> work{localArtworks.length === 1 ? '' : 's'} exhibited as a guest
        in this browser. Import {localArtworks.length === 1 ? 'it' : 'them'} into your account so they appear on
        every device and can be published?
      </p>
      <div className="hako-actions" style={{ marginTop: '0.8rem' }}>
        <button className="btn-line" disabled={busy} onClick={() => void importAll()}>
          {busy ? 'Importing…' : 'Import to my account'}
        </button>
        <button className="btn-line" disabled={busy} onClick={dismiss}>Not now</button>
      </div>
    </div>
  )
}

// Create a hakoniwa as a two-step wizard: SEE the template first, then name it,
// and land straight in the editor with the themed room around you (REQUIREMENTS 10.2)
function CreateCard({ onCreated }: { onCreated: () => void }) {
  const user = useGallery((s) => s.user)!
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [title, setTitle] = useState('My Gallery')
  const [templateId, setTemplateId] = useState('salon')
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      await createGallery(user.id, { title, templateId })
      await refreshMyGallery()
      onCreated()
      router.push('/demo') // straight into the room — the result is the feedback
    } catch (e) {
      alert(`Could not create the hakoniwa: ${e instanceof Error ? e.message : e}`)
      setBusy(false)
    }
  }

  if (step === 1) {
    return (
      <div className="me-card">
        <p className="me-note" style={{ marginTop: 0 }}>
          <b style={{ color: 'var(--ink)' }}>Step 1 of 2</b> — pick the room you&apos;ll start from.
          Colours, floor plan and framing are all shown; everything can be changed later.
        </p>
        <div className="tpl-grid">
          {Object.keys(TEMPLATES).map((key) => (
            <TemplateCard key={key} templateId={key} active={key === templateId} onClick={() => setTemplateId(key)} />
          ))}
        </div>
        <button className="btn-line" onClick={() => setStep(2)}>
          Continue with {TEMPLATES[templateId]?.label} →
        </button>
      </div>
    )
  }

  return (
    <div className="me-card">
      <p className="me-note" style={{ marginTop: 0 }}>
        <b style={{ color: 'var(--ink)' }}>Step 2 of 2</b> — name your hakoniwa. This is the exhibition
        title visitors will see.
      </p>
      <label className="me-field">
        <span>Name</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <div className="hako-actions">
        <button className="btn-line" disabled={busy} onClick={() => setStep(1)}>← Back</button>
        <button className="btn-line" disabled={busy} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create & open the editor'}
        </button>
      </div>
    </div>
  )
}

function HakoniwaCard({ row, onChanged }: { row: GalleryRow; onChanged: () => void }) {
  const user = useGallery((s) => s.user)!
  const username = useGallery((s) => s.profileUsername)
  const cloudArtworks = useGallery((s) => s.cloudArtworks)
  const frameOverrides = useGallery((s) => s.frameOverrides)
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const [usernameInput, setUsernameInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'view' | 'rename' | 'url' | 'space'>('view')
  const [nameInput, setNameInput] = useState(row.title)
  const [slugInput, setSlugInput] = useState(row.slug)
  const [copied, setCopied] = useState(false)
  const [stats, setStats] = useState<EngagementSummary | null>(null)

  // Visitor engagement counts (needs migration 0008; hide quietly if unapplied)
  useEffect(() => {
    let alive = true
    engagementSummary(row.id)
      .then((s) => alive && setStats(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [row.id])

  const publicUrl =
    typeof window !== 'undefined' && username ? `${location.origin}/@${username}/${row.slug}` : ''

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      await refreshMyGallery()
      onChanged()
    } catch (e) {
      alert(`${label} failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  async function togglePublic() {
    if (!row.is_public && cloudArtworks.length === 0) {
      alert('Exhibit at least one work before opening to the public (use the editor).')
      return
    }
    await run(row.is_public ? 'Making private' : 'Publishing', () =>
      setGalleryPublic(row, !row.is_public, rowToSettings(row, frameOverrides), cloudArtworks)
    )
  }

  // Quick space change without opening the editor. Theme changes are cosmetic;
  // layout changes re-cap the placements, so public rooms are rebuilt too
  async function setSpace(partial: { theme?: string; layout?: string }) {
    const s = { ...rowToSettings(row, frameOverrides), ...partial }
    await run('Space change', async () => {
      await saveGallerySpace(row.id, s)
      if (row.is_public) await rebuildPlacements(row.id, s, cloudArtworks)
    })
  }

  // Publishing needs a username — set it right here instead of hunting for the Profile section
  async function saveUsernameInline() {
    const name = usernameInput.trim().toLowerCase()
    if (!USERNAME_RE.test(name)) {
      alert('Usernames are 3–20 characters: lowercase letters, digits and _')
      return
    }
    setBusy(true)
    try {
      await setUsername(user.id, name)
      await refreshCloud()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Cover: the chosen OGP work, else the first exhibited work, else the theme itself
  const coverArt = cloudArtworks.find((a) => a.id === row.cover_artwork_id) ?? cloudArtworks[0]
  const coverSrc = coverArt ? coverArt.poster ?? coverArt.src : undefined

  return (
    <div className="me-card">
      {/* What the room looks like: cover work, theme colours, floor plan */}
      <div className="hako-visual">
        {coverSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hako-cover" src={coverSrc} alt="" />
        ) : (
          <ThemeSwatch themeKey={row.theme} className="hako-cover-swatch" />
        )}
        <span className="hako-plan-chip">
          <LayoutPlan layoutKey={row.layout} params={row.layout_params} />
        </span>
        <span className="hako-space-tag">
          <ThemeSwatch themeKey={row.theme} />
          {THEMES[row.theme]?.label ?? row.theme} ·{' '}
          {row.layout === 'custom' ? 'Custom room' : LAYOUTS[row.layout]?.label ?? row.layout}
        </span>
      </div>
      <div className="hako-head">
        <span className="hako-title">{row.title}</span>
        <span className={`hako-badge${row.is_public ? ' public' : ''}`}>
          {row.is_public ? 'PUBLIC' : 'PRIVATE'}
        </span>
      </div>
      <p className="hako-meta">
        {cloudArtworks.length} work{cloudArtworks.length === 1 ? '' : 's'} exhibited
        {stats ? ` · ${stats.visits} visit${stats.visits === 1 ? '' : 's'} · ♥ ${stats.likes} · ✎ ${stats.guestbook}` : ''}
        {row.updated_at ? ` · updated ${fmtDate(row.updated_at)}` : ''}
        {row.is_public && publicUrl ? (
          <>
            {' · '}
            <a href={publicUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
              {publicUrl.replace(/^https?:\/\//, '')}
            </a>
          </>
        ) : null}
      </p>

      {mode === 'rename' && (
        <div className="field-row">
          <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
          <button
            className="btn-line"
            disabled={busy}
            onClick={() =>
              void run('Rename', async () => {
                await renameGallery(row.id, nameInput)
                setMode('view')
              })
            }
          >
            Save
          </button>
          <button className="btn-line" onClick={() => setMode('view')}>Cancel</button>
        </div>
      )}
      {mode === 'url' && (
        <>
          <div className="field-row">
            <span className="slug-prefix">/@{username ?? 'you'}/</span>
            <input type="text" value={slugInput} onChange={(e) => setSlugInput(e.target.value)} />
            <button
              className="btn-line"
              disabled={busy}
              onClick={() =>
                void run('URL change', async () => {
                  await updateGallerySlug(row.id, slugInput)
                  setMode('view')
                })
              }
            >
              Save
            </button>
            <button className="btn-line" onClick={() => setMode('view')}>Cancel</button>
          </div>
          {row.is_public && (
            <p className="me-note">Changing the URL breaks links you have already shared.</p>
          )}
        </>
      )}
      {!username && (
        <div className="field-row">
          <input
            type="text"
            placeholder="username — needed to publish (/@you/…)"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
          />
          <button className="btn-line" disabled={busy || !usernameInput.trim()} onClick={() => void saveUsernameInline()}>
            Set
          </button>
        </div>
      )}

      {mode === 'space' && (
        <>
          <p className="me-note" style={{ marginTop: 0 }}>Theme</p>
          <div className="chips" style={{ marginBottom: '0.9rem' }}>
            {Object.entries(THEMES).map(([key, def]) => (
              <button
                key={key}
                className={`chip chip-visual${key === row.theme ? ' active' : ''}`}
                disabled={busy}
                onClick={() => void setSpace({ theme: key })}
              >
                <ThemeSwatch themeKey={key} />
                {def.label}
              </button>
            ))}
          </div>
          <p className="me-note" style={{ marginTop: 0 }}>Layout</p>
          <div className="chips" style={{ marginBottom: '0.9rem' }}>
            {Object.entries(LAYOUTS).map(([key, def]) => (
              <button
                key={key}
                className={`chip chip-visual${key === row.layout ? ' active' : ''}`}
                disabled={busy}
                onClick={() => void setSpace({ layout: key })}
              >
                <LayoutPlan layoutKey={key} className="chip-plan" />
                {def.label}
              </button>
            ))}
            {row.layout === 'custom' && (
              <button className="chip chip-visual active" disabled>
                <LayoutPlan layoutKey="custom" params={row.layout_params} className="chip-plan" />
                Custom
              </button>
            )}
          </div>
          <p className="me-note">
            Framing, hanging, captions and the custom room live in the{' '}
            <Link href="/demo" style={{ color: 'var(--gold)' }}>editor</Link>, where you see them on the walls.
          </p>
          <button className="btn-line" onClick={() => setMode('view')}>Done</button>
        </>
      )}
      {mode === 'view' && (
        <div className="hako-actions">
          <Link className="btn-line" href="/demo">Open editor</Link>
          <button className="btn-line" disabled={busy} onClick={() => setMode('space')}>
            Change space
          </button>
          <button
            className="btn-line"
            disabled={busy || (!row.is_public && !username)}
            title={!row.is_public && !username ? 'Set a username first' : undefined}
            onClick={() => void togglePublic()}
          >
            {row.is_public ? 'Make private' : 'Open to the public'}
          </button>
          {row.is_public && publicUrl && (
            <button
              className="btn-line"
              onClick={() => {
                void navigator.clipboard.writeText(publicUrl).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                })
              }}
            >
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          )}
          <button className="btn-line" onClick={() => { setNameInput(row.title); setMode('rename') }}>
            Rename
          </button>
          <button className="btn-line" onClick={() => { setSlugInput(row.slug); setMode('url') }}>
            Change URL
          </button>
          <button
            className="btn-line hako-danger"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Delete “${row.title}”? Your works stay in the library, but the room and its public page are removed.`)) return
              void run('Delete', () => deleteGallery(row.id))
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// Works library (REQUIREMENTS 10.3): user-level assets, reusable across hakoniwa
function WorksCard() {
  const user = useGallery((s) => s.user)!
  const cloudArtworks = useGallery((s) => s.cloudArtworks)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const myGallery = useGallery((s) => s.myGallery)
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const [uploading, setUploading] = useState(false)

  // OGP/artist-page cover (decision 10.8-7: slot 0 unless chosen here)
  async function toggleCover(art: ArtworkData) {
    if (!myGallery) return
    const next = myGallery.cover_artwork_id === art.id ? null : art.id
    try {
      await setGalleryCover(myGallery.id, next)
      await refreshMyGallery()
    } catch (e) {
      alert(`Could not set the cover: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) {
        if (f.type.startsWith('video/')) {
          alert(`Videos are uploaded from the editor (“Exhibit your work”) — skipped “${f.name}”.`)
          continue
        }
        const title = f.name.replace(/\.[^.]+$/, '') || 'Untitled'
        const { dataUrl, w, h } = await fileToDataUrl(f, 1600)
        await uploadArtwork({ ownerId: user.id, dataUrl, title, w, h })
      }
      await refreshCloud()
    } catch (e) {
      alert(`Upload failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setUploading(false)
    }
  }

  async function remove(art: ArtworkData) {
    let msg = `Remove “${art.title}” from your library?`
    try {
      if ((await artworkPlacementCount(art.id)) > 0) {
        msg = `“${art.title}” is hanging in your public hakoniwa. Removing it also takes it off the wall. Continue?`
      }
    } catch {
      /* placements unreadable — fall back to the generic confirm */
    }
    if (!confirm(msg)) return
    try {
      await deleteArtwork(user.id, art.id)
      await refreshCloud()
    } catch (e) {
      alert(`Could not remove the work: ${e instanceof Error ? e.message : e}`)
    }
  }

  return (
    <div className="me-card">
      {cloudArtworks.length === 0 && (
        <p className="me-note" style={{ marginTop: 0 }}>
          No works in your library yet. Upload images here, then arrange them in the editor.
        </p>
      )}
      {cloudArtworks.length > 0 && (
        <p className="me-note" style={{ marginTop: 0, marginBottom: '0.8rem' }}>
          ★ share cover (OGP) · × delete from library
        </p>
      )}
      {cloudArtworks.length > 0 && (
        <div className="works-grid">
          {cloudArtworks.map((art) => (
            <figure className="works-cell" key={art.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art.poster ?? art.src} alt={art.title} loading="lazy" />
              <figcaption>{art.kind === 'video' ? `🎬 ${art.title}` : art.title}</figcaption>
              <button aria-label={`Remove ${art.title}`} onClick={() => void remove(art)}>×</button>
              {myGallery && (
                <button
                  className={`works-star${myGallery.cover_artwork_id === art.id ? ' active' : ''}`}
                  aria-label={`Use ${art.title} as the share cover`}
                  title="Use as share cover (OGP)"
                  onClick={() => void toggleCover(art)}
                >
                  {myGallery.cover_artwork_id === art.id ? '★' : '☆'}
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
      <label className="btn-line file-btn" aria-disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload images'}
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
      <p className="me-note">
        Works are library assets — deleting a hakoniwa never deletes them. Videos are uploaded from the editor.
      </p>
    </div>
  )
}

// Guestbook moderation: read what visitors wrote, delete spam
function GuestbookCard({ galleryId }: { galleryId: string }) {
  const [entries, setEntries] = useState<GuestbookEntry[] | null>(null)

  const load = useCallback(() => {
    listGuestbook(galleryId, 30)
      .then(setEntries)
      .catch(() => setEntries(null))
  }, [galleryId])

  useEffect(() => {
    load()
  }, [load])

  if (entries === null) return null // migration 0008 not applied (or fetch failed) — hide quietly
  return (
    <div className="me-card" style={{ marginTop: '1rem' }}>
      {entries.length === 0 && (
        <p className="me-note" style={{ marginTop: 0 }}>No guestbook entries yet.</p>
      )}
      <ul className="gb-list">
        {entries.map((e) => (
          <li key={e.id}>
            <div className="gb-meta">
              <b>{e.name || 'Anonymous'}</b> · {fmtDate(e.created_at)}
              <button
                aria-label="Delete entry"
                onClick={() => {
                  if (!confirm('Delete this guestbook entry?')) return
                  void deleteGuestbookEntry(e.id).then(load)
                }}
              >
                ×
              </button>
            </div>
            <p>{e.message}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Account operations (REQUIREMENTS 10.1): email change, password change, deletion
function AccountCard() {
  const user = useGallery((s) => s.user)!
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  async function changeEmail() {
    const email = newEmail.trim()
    if (!email || busy) return
    setBusy(true)
    try {
      const { error } = await supabase!.auth.updateUser({ email })
      if (error) throw error
      setEmailSent(true)
    } catch (e) {
      alert(`Could not start the email change: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  async function removeAccount() {
    if (
      !confirm(
        'Delete your account? Your hakoniwa, its public page, and every uploaded work will be permanently removed.'
      )
    )
      return
    if (!confirm('This cannot be undone. Really delete everything?')) return
    setBusy(true)
    try {
      await deleteMyAccount(user.id)
      location.href = '/'
    } catch (e) {
      console.error('account deletion failed (is 0007_delete_account.sql applied?):', e)
      alert(`Account deletion failed — nothing was removed. ${e instanceof Error ? e.message : e}`)
      setBusy(false)
    }
  }

  return (
    <div className="me-card">
      <label className="me-field">
        <span>Email — currently {user.email ?? '(none)'}</span>
        <div className="field-row" style={{ marginTop: 0 }}>
          <input
            type="email"
            placeholder="new@email.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button className="btn-line" disabled={busy || !newEmail.trim()} onClick={() => void changeEmail()}>
            Change
          </button>
        </div>
      </label>
      {emailSent && (
        <p className="me-note">
          Confirmation link(s) sent — open them to complete the change.
        </p>
      )}
      <div className="hako-actions">
        <Link className="btn-line" href="/reset">Change password</Link>
        <button className="btn-line hako-danger" disabled={busy} onClick={() => void removeAccount()}>
          Delete account
        </button>
      </div>
    </div>
  )
}

function ProfileCard() {
  const user = useGallery((s) => s.user)!
  const username = useGallery((s) => s.profileUsername)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const [nameInput, setNameInput] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    getProfile(user.id)
      .then((p) => {
        if (!alive) return
        setDisplayName(p.displayName)
        setBio(p.bio)
        setAvatarUrl(p.avatarUrl)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user.id])

  async function onAvatarFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      setAvatarUrl(await uploadAvatar(user.id, file))
    } catch (e) {
      alert(`Avatar upload failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  async function saveUsername() {
    const name = nameInput.trim().toLowerCase()
    if (!USERNAME_RE.test(name)) {
      alert('Usernames are 3–20 characters: lowercase letters, digits and _')
      return
    }
    setBusy(true)
    try {
      await setUsername(user.id, name)
      await refreshCloud()
      setNameInput('')
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      await saveProfile(user.id, { displayName, bio })
      await refreshCloud()
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    } catch (e) {
      alert(`Could not save your profile: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="me-card">
      <div className="avatar-row">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar-img" src={avatarUrl} alt="Avatar" />
        ) : (
          <div className="avatar-img avatar-empty">{(displayName || 'A').slice(0, 1).toUpperCase()}</div>
        )}
        <label className="btn-line file-btn" aria-disabled={busy} style={{ marginTop: 0 }}>
          {busy ? 'Uploading…' : avatarUrl ? 'Change avatar' : 'Upload avatar'}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={busy}
            onChange={(e) => {
              void onAvatarFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <label className="me-field">
        <span>Username — public URL: /@{username ?? 'username'}/…</span>
        <div className="field-row" style={{ marginTop: 0 }}>
          <input
            type="text"
            placeholder={username ?? 'username'}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <button className="btn-line" disabled={busy || !nameInput.trim()} onClick={() => void saveUsername()}>
            {username ? 'Change' : 'Set'}
          </button>
        </div>
      </label>
      <label className="me-field">
        <span>Display name (artist name)</span>
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="me-field">
        <span>Bio / statement</span>
        <textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>
      <button className="btn-line" disabled={busy} onClick={() => void save()}>
        {saved ? 'Saved' : 'Save profile'}
      </button>
    </div>
  )
}

export default function MePage() {
  const user = useGallery((s) => s.user)
  const initAuth = useGallery((s) => s.initAuth)
  const hydrate = useGallery((s) => s.hydrate)
  const signOut = useGallery((s) => s.signOut)

  const [checked, setChecked] = useState(false)
  // null = still loading (prevents flashing the create card at returning users)
  const [galleries, setGalleries] = useState<GalleryRow[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [usage, setUsage] = useState<number | null>(null)

  useEffect(() => {
    hydrate() // frameOverrides etc. from this browser feed placement rebuilds
    initAuth()
    supabase?.auth.getSession().then(() => setChecked(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reload = useCallback(async () => {
    if (!user) return
    try {
      setGalleries(await listMyGalleries(user.id))
      setLoadErr('')
    } catch (e) {
      console.error('could not load galleries (are supabase/migrations applied?):', e)
      setLoadErr('Could not load your hakoniwa — please retry in a moment.')
      setGalleries([])
    }
    try {
      setUsage(await getStorageUsage(user.id))
    } catch {
      setUsage(null) // bytes column missing (0006 not applied) — hide the meter
    }
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!supabase) {
    return (
      <AuthShell title="Dashboard">
        <p className="auth-note">Cloud features are not configured (Supabase keys required in .env.local).</p>
        <p className="auth-links">
          <Link href="/">Back to HAKONIWA</Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <main className="me-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">HAKONIWA</Link>
          <div className="me-top-actions">
            <Link className="btn-line" href="/demo">Editor</Link>
            {user && (
              <button className="btn-line" onClick={() => void signOut()}>Sign out</button>
            )}
          </div>
        </div>

        {!user && checked && (
          <div className="me-card">
            <p className="me-note" style={{ marginTop: 0 }}>You are not signed in.</p>
            <div className="hako-actions">
              <Link className="btn-line" href="/signin">Sign in</Link>
              <Link className="btn-line" href="/signup">Create account</Link>
            </div>
          </div>
        )}

        {user && (
          <>
            <h1 className="me-h1">My hakoniwa</h1>
            <GuestImportCard />
            <section className="me-section">
              {loadErr && <p className="me-error">{loadErr}</p>}
              {galleries === null && !loadErr && <p className="me-note">Loading your hakoniwa…</p>}
              {galleries !== null && !loadErr && galleries.length === 0 && (
                <CreateCard onCreated={() => void reload()} />
              )}
              {(galleries ?? []).map((g) => (
                <HakoniwaCard key={g.id} row={g} onChanged={() => void reload()} />
              ))}
              {galleries !== null && galleries.length > 0 && galleries.length < PLAN.galleries && (
                <p className="me-note">
                  You can create {PLAN.galleries - galleries.length} more hakoniwa on your plan.
                </p>
              )}
              {usage !== null && (
                <p className="me-note">
                  Storage: {(usage / 1024 / 1024).toFixed(1)} MB of {Math.round(PLAN.storageBytes / 1024 / 1024)} MB used
                </p>
              )}
            </section>

            {/* First-run order: works → profile (username) → guestbook → account */}
            <section className="me-section">
              <h2>Works</h2>
              <WorksCard />
            </section>

            <section className="me-section">
              <h2>Profile</h2>
              <ProfileCard />
            </section>

            {galleries !== null && galleries.length > 0 && (
              <section className="me-section">
                <h2>Guestbook</h2>
                <GuestbookCard galleryId={galleries[0].id} />
              </section>
            )}

            <section className="me-section">
              <h2>Account</h2>
              <AccountCard />
            </section>
          </>
        )}

        <footer className="artist-footer">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  )
}
