'use client'
// Dashboard: manage your hakoniwa (create / rename / publish / delete), profile, and links.
// Designed for multiple galleries; the release plan caps creation at PLAN.galleries.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useGallery } from '@/lib/store'
import { TEMPLATES, THEMES, LAYOUTS, FRAMES, MATS, HANGINGS, CAPTIONS } from '@/lib/presets'
import { setOverride } from '@/lib/exhibition'
import {
  ThemeSwatch,
  LayoutPlan,
  TemplateCard,
  WallPreview,
  FramedArt,
  HangingIcon,
  CaptionIcon,
} from '@/components/SpacePreviews'
import { PLAN } from '@/lib/limits'
import {
  listMyGalleries,
  createGallery,
  updateGalleryDetails,
  deleteGallery,
  setGalleryPublic,
  setGalleryCover,
  saveGallerySpace,
  rebuildPlacements,
  fetchPlacementOverrides,
  rowToSettings,
  EMPTY_OVERRIDES,
  type PlacementOverrides,
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

// The works preview is the REAL renderer (three.js), loaded only when needed;
// until the chunk arrives the flat CSS preview holds the same footprint
const Preview3D = dynamic(() => import('@/components/Preview3D'), { ssr: false })

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
  const updateSettings = useGallery((s) => s.updateSettings)
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [title, setTitle] = useState('My Gallery')
  const [statement, setStatement] = useState('')
  const [templateId, setTemplateId] = useState('salon')
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      await createGallery(user.id, { title, templateId, statement })
      await refreshMyGallery()
      // Persist the template locally too, so the editor's hydrate() can't fall back
      // to stale localStorage defaults after the client-side navigation
      const t = TEMPLATES[templateId]
      if (t) {
        updateSettings({
          theme: t.theme,
          layout: t.layout,
          frame: t.frame,
          hanging: t.hanging,
          caption: t.caption,
          frameOverrides: {},
        })
      }
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
        {/* One preview per card (the card top IS the wall preview) — no duplicate block */}
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
      <label className="me-field">
        <span>Concept / intro (optional) — shown on the board at the back of your room</span>
        <textarea
          rows={3}
          maxLength={200}
          placeholder="What is this exhibition about? Who are you?"
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
        />
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
  const matOverrides = useGallery((s) => s.matOverrides)
  const hangingOverrides = useGallery((s) => s.hangingOverrides)
  const captionOverrides = useGallery((s) => s.captionOverrides)
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const [usernameInput, setUsernameInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'view' | 'details' | 'space'>('view')
  const [nameInput, setNameInput] = useState(row.title)
  const [statementInput, setStatementInput] = useState(row.statement)
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

  // The shareable URL is just /@name while the plan allows one hakoniwa
  // (the slug mechanism stays in the DB for the multi-gallery future)
  const publicUrl = typeof window !== 'undefined' && username ? `${location.origin}/@${username}` : ''

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

  // Per-work design may have been set on another device — merge the placements'
  // stored overrides under this browser's, or a rebuild here would wipe them
  async function mergedOverrides(): Promise<PlacementOverrides> {
    const saved = await fetchPlacementOverrides(row.id).catch(() => EMPTY_OVERRIDES)
    return {
      frames: { ...saved.frames, ...frameOverrides },
      mats: { ...saved.mats, ...matOverrides },
      hangings: { ...saved.hangings, ...hangingOverrides },
      captions: { ...saved.captions, ...captionOverrides },
    }
  }

  async function togglePublic() {
    if (!row.is_public && cloudArtworks.length === 0) {
      alert('Exhibit at least one work before opening to the public (use the editor).')
      return
    }
    await run(row.is_public ? 'Making private' : 'Publishing', async () =>
      setGalleryPublic(row, !row.is_public, rowToSettings(row, await mergedOverrides()), cloudArtworks)
    )
  }

  // Quick space change without opening the editor. Theme changes are cosmetic;
  // layout changes re-cap the placements, so public rooms are rebuilt too
  async function setSpace(partial: Partial<Pick<ReturnType<typeof rowToSettings>, 'theme' | 'layout' | 'frame' | 'mat' | 'hanging' | 'caption'>>) {
    await run('Space change', async () => {
      const s = { ...rowToSettings(row, await mergedOverrides()), ...partial }
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
  // (videos show their poster; a poster-less video falls back to the swatch)
  const coverArt = cloudArtworks.find((a) => a.id === row.cover_artwork_id) ?? cloudArtworks[0]
  const coverSrc = coverArt
    ? coverArt.kind === 'video'
      ? coverArt.poster
      : coverArt.poster ?? coverArt.src
    : undefined

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
        {/* Text only — the big cover/swatch next to it already IS the theme preview */}
        <span className="hako-space-tag">
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

      {mode === 'details' && (
        <>
          <label className="me-field">
            <span>Exhibition title</span>
            <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
          </label>
          <label className="me-field">
            <span>Concept / intro — shown on the board at the back of your room</span>
            <textarea
              rows={3}
              maxLength={200}
              placeholder="What is this exhibition about? Who are you?"
              value={statementInput}
              onChange={(e) => setStatementInput(e.target.value)}
            />
          </label>
          <div className="hako-actions">
            <button
              className="btn-line"
              disabled={busy}
              onClick={() =>
                void run('Save details', async () => {
                  await updateGalleryDetails(row.id, { title: nameInput, statement: statementInput })
                  setMode('view')
                })
              }
            >
              Save
            </button>
            <button className="btn-line" onClick={() => setMode('view')}>Cancel</button>
          </div>
        </>
      )}
      {!username && (
        <div className="field-row">
          <input
            type="text"
            placeholder="username — needed to publish (/@you)"
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
          {/* The room's current look: wall + YOUR cover work in its frame, hanging and caption */}
          <WallPreview
            themeKey={row.theme}
            frameKey={row.frame_default}
            hangingKey={row.hanging_default}
            captionKey={row.caption_default}
            artSrc={coverSrc}
            artRatio={coverArt?.ratio}
          />
          <p className="me-note">
            How a work hangs right now — {THEMES[row.theme]?.label ?? row.theme} theme,{' '}
            {FRAMES[row.frame_default]?.label ?? row.frame_default} frame. Picking a theme applies its
            recommended framing.
          </p>
          <p className="me-note" style={{ marginTop: 0 }}>Theme</p>
          <div className="chips" style={{ marginBottom: '0.9rem' }}>
            {Object.entries(THEMES).map(([key, def]) => (
              <button
                key={key}
                className={`chip chip-visual${key === row.theme ? ' active' : ''}`}
                disabled={busy}
                onClick={() => void setSpace({ theme: key, ...def.recommends, mat: 'auto' })}
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
            {/* layout_params survive preset switches (saveGallerySpace preserves them),
                so a saved custom room is always one click away */}
            <button
              className={`chip chip-visual${row.layout === 'custom' ? ' active' : ''}`}
              disabled={busy}
              onClick={() => void setSpace({ layout: 'custom' })}
            >
              <LayoutPlan layoutKey="custom" params={row.layout_params} className="chip-plan" />
              Custom
            </button>
          </div>
          <p className="me-note">
            Framing, hanging, captions and the custom room live in the{' '}
            <Link href="/demo" style={{ color: 'var(--gold)' }}>editor</Link>, where you see them on the walls.
          </p>
          <button className="btn-line" onClick={() => setMode('view')}>Done</button>
        </>
      )}
      {mode === 'view' && (
        <>
          {/* Primary actions: enter the room, style it, share it */}
          <div className="hako-actions">
            <Link className="btn-line btn-gold" href="/demo">Open editor</Link>
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
          </div>
          {/* Quiet row for rare / destructive housekeeping — not peers of the actions above */}
          <div className="hako-secondary">
            <button
              onClick={() => {
                setNameInput(row.title)
                setStatementInput(row.statement)
                setMode('details')
              }}
            >
              Edit details
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (!confirm(`Delete “${row.title}”? Your works stay in the library, but the room and its public page are removed.`)) return
                void run('Delete', () => deleteGallery(row.id))
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Works library (REQUIREMENTS 10.3): user-level assets, reusable across hakoniwa.
// Two columns: upload + library on the left, and the SELECTED work hanging in the
// room's actual frame/theme on the right — upload, click, confirm in one view.
function WorksCard() {
  const user = useGallery((s) => s.user)!
  const cloudArtworks = useGallery((s) => s.cloudArtworks)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const myGallery = useGallery((s) => s.myGallery)
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const frameOverrides = useGallery((s) => s.frameOverrides)
  const matOverrides = useGallery((s) => s.matOverrides)
  const hangingOverrides = useGallery((s) => s.hangingOverrides)
  const captionOverrides = useGallery((s) => s.captionOverrides)
  const updateSettings = useGallery((s) => s.updateSettings)
  const syncState = useGallery((s) => s.syncState)
  const [uploading, setUploading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = cloudArtworks.find((a) => a.id === selectedId) ?? cloudArtworks[0]
  // The wall the preview hangs on: the user's real room, or the defaults before one exists
  const theme = myGallery?.theme ?? 'chic'
  const baseFrame = myGallery?.frame_default ?? 'black'
  const baseMat = myGallery?.mat_default ?? 'auto'
  const baseHanging = myGallery?.hanging_default ?? 'wire'
  const baseCaption = myGallery?.caption_default ?? 'side'
  // Effective per-work design: the override when set, else the gallery default
  const frame = (selected && frameOverrides[selected.id]) || baseFrame
  const mat = (selected && matOverrides[selected.id]) || baseMat
  const hanging = (selected && hangingOverrides[selected.id]) || baseHanging
  const caption = (selected && captionOverrides[selected.id]) || baseCaption
  // Videos hang by their poster; a poster-less video previews as the placeholder
  const previewSrc = selected
    ? selected.kind === 'video'
      ? selected.poster
      : selected.poster ?? selected.src
    : undefined

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
      <div className="works-editor">
        <div className="we-left">
          {cloudArtworks.length === 0 && (
            <p className="me-note" style={{ marginTop: 0 }}>
              No works in your library yet. Upload images here — the preview alongside shows how
              each one hangs in your room.
            </p>
          )}
          {cloudArtworks.length > 0 && (
            <p className="me-note" style={{ marginTop: 0, marginBottom: '0.8rem' }}>
              Click a work to preview it framed · ★ share cover (OGP) · × delete from library
            </p>
          )}
          {cloudArtworks.length > 0 && (
            <div className="works-grid">
              {cloudArtworks.map((art) => (
                <figure className={`works-cell${selected?.id === art.id ? ' selected' : ''}`} key={art.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={art.poster ?? art.src}
                    alt={art.title}
                    loading="lazy"
                    onClick={() => setSelectedId(art.id)}
                  />
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
            Works are library assets — deleting a hakoniwa never deletes them. Videos are uploaded
            from the editor.
          </p>
        </div>

        {/* Live preview: the selected upload rendered by the ACTUAL 3D pipeline
            (same Exhibit component as the room), with the per-work design controls
            right under what they change. Poster-less videos and the empty state
            fall back to the flat CSS preview. */}
        <div className="we-right">
          {selected && previewSrc ? (
            <div className="wall-preview3d">
              <Preview3D
                art={selected.kind === 'video' ? { ...selected, kind: 'image', src: previewSrc } : selected}
                themeKey={theme}
                frameKey={frame}
                matKey={mat}
                hangingKey={hanging}
                captionKey={caption}
              />
            </div>
          ) : (
            <WallPreview
              themeKey={theme}
              frameKey={frame}
              matKey={mat}
              hangingKey={hanging}
              captionKey={caption}
              artSrc={previewSrc}
              artRatio={selected?.ratio}
              className="wall-preview--lg"
            />
          )}
          {!selected && (
            <p className="me-note">
              Upload a work to see it hanging in your theme and frame before you publish.
            </p>
          )}
          {selected && !myGallery && (
            <p className="me-note">
              “{selected.title}” with the default framing — create your hakoniwa to style it.
            </p>
          )}
          {selected && myGallery && (
            <>
              <p className="me-note" style={{ marginBottom: '0.4rem' }}>
                “{selected.title}” — design for <b style={{ color: 'var(--ink)' }}>this work</b>
                {syncState === 'saving' ? ' · saving…' : syncState === 'saved' ? ' · saved' : ''}
              </p>
              <div className="chips we-chips">
                {Object.entries(FRAMES).map(([key, def]) => (
                  <button
                    key={key}
                    className={`chip chip-visual${frame === key ? ' active' : ''}`}
                    title={`${def.label} frame`}
                    onClick={() =>
                      updateSettings({ frameOverrides: setOverride(frameOverrides, selected.id, key, baseFrame) })
                    }
                  >
                    <FramedArt frameKey={key} className="chip-frame" />
                    {def.label}
                  </button>
                ))}
              </div>
              <div className="chips we-chips">
                {Object.entries(MATS).map(([key, def]) => (
                  <button
                    key={key}
                    className={`chip chip-visual${mat === key ? ' active' : ''}`}
                    title={`${def.label} mat`}
                    onClick={() =>
                      updateSettings({ matOverrides: setOverride(matOverrides, selected.id, key, baseMat) })
                    }
                  >
                    <FramedArt frameKey={frame} matKey={key} className="chip-frame" />
                    {def.label}
                  </button>
                ))}
              </div>
              <div className="chips we-chips">
                {Object.entries(HANGINGS).map(([key, def]) => (
                  <button
                    key={key}
                    className={`chip chip-visual${hanging === key ? ' active' : ''}`}
                    title={`${def.label} hanging`}
                    onClick={() =>
                      updateSettings({ hangingOverrides: setOverride(hangingOverrides, selected.id, key, baseHanging) })
                    }
                  >
                    <HangingIcon hangingKey={key} />
                    {def.label}
                  </button>
                ))}
              </div>
              <div className="chips we-chips">
                {Object.entries(CAPTIONS).map(([key, def]) => (
                  <button
                    key={key}
                    className={`chip chip-visual${caption === key ? ' active' : ''}`}
                    title={`${def.label} caption`}
                    onClick={() =>
                      updateSettings({ captionOverrides: setOverride(captionOverrides, selected.id, key, baseCaption) })
                    }
                  >
                    <CaptionIcon captionKey={key} />
                    {def.label}
                  </button>
                ))}
              </div>
              <p className="me-note" style={{ marginTop: '0.5rem' }}>
                The theme picks these for the whole room; anything you change here applies to this
                work only. Picking the room's value clears the override.
              </p>
            </>
          )}
        </div>
      </div>
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
        <span>Username — public URL: /@{username ?? 'username'}</span>
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

// Dashboard menus: gallery editing and profile/account editing are separate concerns
const ME_TABS = [
  ['gallery', 'Gallery'],
  ['guestbook', 'Guestbook'],
  ['profile', 'Profile'],
  ['account', 'Account'],
] as const
type MeTab = (typeof ME_TABS)[number][0]

export default function MePage() {
  const user = useGallery((s) => s.user)
  const initAuth = useGallery((s) => s.initAuth)
  const hydrate = useGallery((s) => s.hydrate)
  const signOut = useGallery((s) => s.signOut)

  const [tab, setTab] = useState<MeTab>('gallery')
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
            <h1 className="me-h1">Dashboard</h1>
            <nav className="me-tabs" aria-label="Dashboard sections">
              {ME_TABS.map(([key, label]) => (
                <button
                  key={key}
                  className={`me-tab${tab === key ? ' active' : ''}`}
                  aria-current={tab === key ? 'page' : undefined}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </nav>

            {tab === 'gallery' && (
              <>
                <GuestImportCard />
                <section className="me-section">
                  <h2>My hakoniwa</h2>
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
                </section>

                <section className="me-section">
                  <h2>Works</h2>
                  <WorksCard />
                  {usage !== null && (
                    <p className="me-note">
                      Storage: {(usage / 1024 / 1024).toFixed(1)} MB of{' '}
                      {Math.round(PLAN.storageBytes / 1024 / 1024)} MB used
                    </p>
                  )}
                </section>
              </>
            )}

            {tab === 'guestbook' && (
              <section className="me-section">
                <h2>Guestbook</h2>
                {galleries !== null && galleries.length > 0 ? (
                  <GuestbookCard galleryId={galleries[0].id} />
                ) : (
                  <p className="me-note">
                    Create your hakoniwa first — the guestbook collects what visitors write in your room.
                  </p>
                )}
              </section>
            )}

            {tab === 'profile' && (
              <section className="me-section">
                <h2>Profile</h2>
                <ProfileCard />
              </section>
            )}

            {tab === 'account' && (
              <section className="me-section">
                <h2>Account</h2>
                <AccountCard />
              </section>
            )}
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
