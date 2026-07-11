'use client'
// Dashboard: manage your hakoniwa (create / rename / publish / delete), profile, and links.
// Designed for multiple galleries; the release plan caps creation at PLAN.galleries.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useGallery } from '@/lib/store'
import { TEMPLATES, THEMES, LAYOUTS } from '@/lib/presets'
import { setOverride } from '@/lib/exhibition'
import { ThemeSwatch, LayoutPlan, TemplateCard, WallPreview } from '@/components/SpacePreviews'
import WorkDesign from '@/components/WorkDesign'
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
import { getProfile, saveProfile, setUsername, isPlaceholderTitle, USERNAME_RE } from '@/lib/publish'
import {
  getStorageUsage,
  uploadArtwork,
  uploadAvatar,
  deleteArtwork,
  updateArtworkDetails,
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

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

// The first thing a signed-in artist sees: their own face and name, not a form
function Hero() {
  const user = useGallery((s) => s.user)!
  const displayName = useGallery((s) => s.profileDisplayName)
  const avatarUrl = useGallery((s) => s.profileAvatarUrl)
  const username = useGallery((s) => s.profileUsername)
  const name = displayName || user.displayName
  const h = new Date().getHours()
  const greet = h < 5 ? 'Working late' : h < 11 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="me-hero">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="me-hero-avatar" src={avatarUrl} alt="" />
      ) : (
        <div className="me-hero-avatar empty">{name.slice(0, 1).toUpperCase()}</div>
      )}
      <div>
        <div className="me-hero-greet">{greet}, {name}.</div>
        <p className="me-hero-sub">
          {username ? (
            <>
              Your gallery lives at{' '}
              <a href={`/@${username}`} target="_blank" rel="noreferrer">/@{username}</a>
            </>
          ) : (
            'Set a username to claim your public URL.'
          )}
        </p>
      </div>
    </div>
  )
}

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
  const [title, setTitle] = useState('')
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
          mat: 'auto',
          hanging: t.hanging,
          caption: t.caption,
          frameOverrides: {},
          matOverrides: {},
          hangingOverrides: {},
          captionOverrides: {},
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
        title visitors will see; leave it blank and your artist name leads instead.
      </p>
      <label className="me-field">
        <span>Exhibition title (optional)</span>
        <input
          type="text"
          placeholder="e.g. Blue Hours"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
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

// The hakoniwa card IS the gallery workbench: status + publish on top, then the
// works library on the left and the real-3D preview with every design control —
// per-work title/caption/frame and the room-wide theme/layout — on the right.
function HakoniwaCard({ row, onChanged }: { row: GalleryRow; onChanged: () => void }) {
  const user = useGallery((s) => s.user)!
  const username = useGallery((s) => s.profileUsername)
  const cloudArtworks = useGallery((s) => s.cloudArtworks)
  const frameOverrides = useGallery((s) => s.frameOverrides)
  const matOverrides = useGallery((s) => s.matOverrides)
  const hangingOverrides = useGallery((s) => s.hangingOverrides)
  const captionOverrides = useGallery((s) => s.captionOverrides)
  const updateSettings = useGallery((s) => s.updateSettings)
  const syncState = useGallery((s) => s.syncState)
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const [usernameInput, setUsernameInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState(row.title)
  const [statementInput, setStatementInput] = useState(row.statement)
  const [detailsState, setDetailsState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const detailsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [copied, setCopied] = useState(false)
  const [stats, setStats] = useState<EngagementSummary | null>(null)
  const [uploading, setUploading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [titleInput, setTitleInput] = useState('')
  const [captionInput, setCaptionInput] = useState('')
  const [workSaved, setWorkSaved] = useState(false)

  const selected = cloudArtworks.find((a) => a.id === selectedId) ?? cloudArtworks[0]
  const selectedIndex = selected ? cloudArtworks.indexOf(selected) : 0
  // Effective per-work design: the override when set, else the gallery default
  const frame = (selected && frameOverrides[selected.id]) || row.frame_default
  const mat = (selected && matOverrides[selected.id]) || row.mat_default
  const hanging = (selected && hangingOverrides[selected.id]) || row.hanging_default
  const captionKey = (selected && captionOverrides[selected.id]) || row.caption_default
  // Videos hang by their poster; a poster-less video previews as the placeholder
  const previewSrc = selected
    ? selected.kind === 'video'
      ? selected.poster
      : selected.poster ?? selected.src
    : undefined

  // The plate fields follow whichever work is selected
  useEffect(() => {
    setTitleInput(selected?.title ?? '')
    setCaptionInput(selected?.desc ?? '')
    setWorkSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  // Title + statement are ALWAYS editable — typing autosaves after a short pause
  // (no "Edit details" mode). Debounce lives in a ref so re-renders don't reset it.
  function editDetails(next: { title?: string; statement?: string }) {
    if (next.title !== undefined) setNameInput(next.title)
    if (next.statement !== undefined) setStatementInput(next.statement)
    setDetailsState('saving')
    if (detailsTimer.current) clearTimeout(detailsTimer.current)
    const title = next.title ?? nameInput
    const statement = next.statement ?? statementInput
    detailsTimer.current = setTimeout(() => {
      updateGalleryDetails(row.id, { title, statement })
        .then(async () => {
          await refreshMyGallery()
          onChanged()
          setDetailsState('saved')
          setTimeout(() => setDetailsState('idle'), 1600)
        })
        .catch((e) => {
          alert(`Could not save the details: ${e instanceof Error ? e.message : e}`)
          setDetailsState('idle')
        })
    }, 900)
  }
  useEffect(() => () => {
    if (detailsTimer.current) clearTimeout(detailsTimer.current)
  }, [])

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

  // OGP/artist-page cover (decision 10.8-7: slot 0 unless chosen here)
  async function toggleCover(art: ArtworkData) {
    const next = row.cover_artwork_id === art.id ? null : art.id
    await run('Set cover', () => setGalleryCover(row.id, next))
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) {
        if (f.type.startsWith('video/')) {
          alert(`Videos are uploaded from the 3D preview (“Exhibit your work”) — skipped “${f.name}”.`)
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

  async function removeWork(art: ArtworkData) {
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

  // Title + caption as shown on the work's name plate (and the public page)
  async function saveWorkDetails() {
    if (!selected) return
    setBusy(true)
    try {
      await updateArtworkDetails(selected.id, { title: titleInput, description: captionInput })
      await refreshCloud()
      setWorkSaved(true)
      setTimeout(() => setWorkSaved(false), 1600)
    } catch (e) {
      alert(`Could not save the work details: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  const themeDef = THEMES[row.theme] ?? THEMES.chic

  return (
    <div className="me-card">
      {/* The room's own colours, as a ribbon — this card IS that room */}
      <div
        className="hako-ribbon"
        style={{
          background: `linear-gradient(90deg, ${hex(themeDef.wall)}, ${hex(themeDef.accentWall)} 45%, ${hex(themeDef.spotColor)})`,
        }}
      />
      {/* Title + statement are edited right here — no separate edit mode */}
      <div className="hako-head">
        <input
          className="hako-title-input"
          type="text"
          value={nameInput}
          placeholder="Untitled exhibition — name it"
          aria-label="Exhibition title"
          onChange={(e) => editDetails({ title: e.target.value })}
        />
        {detailsState !== 'idle' && (
          <span className="hako-save-state">{detailsState === 'saving' ? 'saving…' : 'saved'}</span>
        )}
      </div>
      <textarea
        className="hako-statement-input"
        rows={2}
        maxLength={200}
        placeholder="Concept / intro — shown on the board at the back of your room"
        aria-label="Exhibition statement"
        value={statementInput}
        onChange={(e) => editDetails({ statement: e.target.value })}
      />
      {/* The URL and its state live together: flip the switch to open / close the room */}
      {username ? (
        <div className="hako-url-row">
          {row.is_public && publicUrl ? (
            <a className="hako-url" href={publicUrl} target="_blank" rel="noreferrer">
              {publicUrl.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            <span className="hako-url off">{(publicUrl || `/@${username}`).replace(/^https?:\/\//, '')}</span>
          )}
          <label
            className="switch"
            title={
              row.is_public
                ? 'Open — anyone with the URL can visit'
                : cloudArtworks.length
                  ? 'Private — flip to open your gallery to the public'
                  : 'Exhibit at least one work before opening'
            }
          >
            <input type="checkbox" checked={row.is_public} disabled={busy} onChange={() => void togglePublic()} />
            <span className="knob" aria-hidden="true" />
          </label>
          <span className={`hako-state${row.is_public ? ' open' : ''}`}>{row.is_public ? 'OPEN' : 'PRIVATE'}</span>
        </div>
      ) : null}
      <p className="hako-meta">{row.updated_at ? `Updated ${fmtDate(row.updated_at)}` : ''}</p>
      {/* How the exhibition is doing, at a glance */}
      <div className="stat-row">
        <div className="stat"><b>{cloudArtworks.length}</b><span>Works</span></div>
        <div className="stat"><b>{stats ? stats.visits : '–'}</b><span>Visits</span></div>
        <div className="stat"><b>{stats ? stats.likes : '–'}</b><span>Likes</span></div>
        <div className="stat"><b>{stats ? stats.guestbook : '–'}</b><span>Guest notes</span></div>
      </div>

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

      {/* Primary actions: walk the room, share it (open/close lives on the URL row) */}
      <div className="hako-actions">
        <Link className="btn-line btn-gold" href="/demo">Preview in 3D</Link>
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
          className="danger"
          disabled={busy}
          onClick={() => {
            if (!confirm(`Delete “${isPlaceholderTitle(row.title) ? 'your hakoniwa' : row.title}”? Your works stay in the library, but the room and its public page are removed.`)) return
            void run('Delete', () => deleteGallery(row.id))
          }}
        >
          Delete
        </button>
      </div>

      {/* ---- The workbench: a filmstrip of the 10 slots on top, the selected work's
           full-width detail (3D preview + every control) below ---- */}
      {cloudArtworks.length === 0 ? (
        <label className="upload-hero" aria-disabled={uploading} style={{ marginTop: '1.4rem' }}>
          <b>{uploading ? 'Uploading…' : 'Hang your first work'}</b>
          <span>
            Drop in images from your camera roll or portfolio —<br />
            the preview below shows them framed on your wall.
          </span>
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
      ) : (
        <>
          <div className="works-head">
            <span className="works-count">
              {cloudArtworks.length} / {PLAN.worksPerGallery} works
            </span>
            <span className="works-legend">Select a work · ★ cover · × remove</span>
          </div>
          {/* Filmstrip: the 10 slots as a horizontal, scrollable rail */}
          <div className="works-strip">
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
                <button aria-label={`Remove ${art.title}`} onClick={() => void removeWork(art)}>×</button>
                <button
                  className={`works-star${row.cover_artwork_id === art.id ? ' active' : ''}`}
                  aria-label={`Use ${art.title} as the share cover`}
                  title="Use as share cover (OGP)"
                  onClick={() => void toggleCover(art)}
                >
                  {row.cover_artwork_id === art.id ? '★' : '☆'}
                </button>
              </figure>
            ))}
            {/* The add tile lives at the end of the strip */}
            {cloudArtworks.length < PLAN.worksPerGallery && (
              <label className="works-add" aria-disabled={uploading} title="Upload images">
                <span aria-hidden="true">{uploading ? '…' : '+'}</span>
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
            )}
          </div>
        </>
      )}

      {/* Detail: full width below the strip — 3D preview left, every control right.
          Everything here changes what the preview shows — plate text, per-work
          design, and the room itself. Poster-less videos / empty state fall to CSS. */}
      <div className="works-detail">
        <div className="we-left">
          {selected && previewSrc ? (
            <div className="wall-preview3d">
              <Preview3D
                art={selected.kind === 'video' ? { ...selected, kind: 'image', src: previewSrc } : selected}
                index={selectedIndex}
                themeKey={row.theme}
                frameKey={frame}
                matKey={mat}
                hangingKey={hanging}
                captionKey={captionKey}
              />
            </div>
          ) : (
            <WallPreview
              themeKey={row.theme}
              frameKey={frame}
              matKey={mat}
              hangingKey={hanging}
              captionKey={captionKey}
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
        </div>

        <div className="we-right">
          {selected && (
            <>
              <p className="me-note" style={{ marginTop: 0, marginBottom: 0 }}>
                “{selected.title}” — <b style={{ color: 'var(--ink)' }}>this work</b>
                {syncState === 'saving' ? ' · saving…' : syncState === 'saved' ? ' · saved' : ''}
              </p>

              {/* The name plate's text: title + caption, straight onto the plate above */}
              <div className="wd-group" style={{ marginTop: '0.6rem' }}>
                <div className="wd-title"><span>Title &amp; caption</span></div>
                <label className="me-field" style={{ margin: '0.45rem 0' }}>
                  <span>Title</span>
                  <input type="text" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} />
                </label>
                <label className="me-field" style={{ margin: '0.45rem 0' }}>
                  <span>Caption — shown on the name plate</span>
                  <textarea
                    rows={2}
                    maxLength={140}
                    placeholder="A line about this work (year, medium, a thought…)"
                    value={captionInput}
                    onChange={(e) => setCaptionInput(e.target.value)}
                  />
                </label>
                <button
                  className="btn-line"
                  disabled={busy || (titleInput === selected.title && captionInput === (selected.desc ?? ''))}
                  onClick={() => void saveWorkDetails()}
                >
                  {workSaved ? 'Saved' : 'Save plate'}
                </button>
              </div>

              <WorkDesign
                frameKey={frame}
                matKey={mat}
                hangingKey={hanging}
                captionKey={captionKey}
                onFrame={(k) =>
                  updateSettings({ frameOverrides: setOverride(frameOverrides, selected.id, k, row.frame_default) })
                }
                onMat={(k) =>
                  updateSettings({ matOverrides: setOverride(matOverrides, selected.id, k, row.mat_default) })
                }
                onHanging={(k) =>
                  updateSettings({ hangingOverrides: setOverride(hangingOverrides, selected.id, k, row.hanging_default) })
                }
                onCaption={(k) =>
                  updateSettings({ captionOverrides: setOverride(captionOverrides, selected.id, k, row.caption_default) })
                }
              />
            </>
          )}

          {/* Room-wide space: theme recolours the preview wall live; layout is the floor plan */}
          <div className="wd-group">
            <div className="wd-title"><span>Room — whole gallery</span></div>
            <div className="wd-row">
              <span className="wd-label">Theme</span>
              <div className="chips">
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
            </div>
            <div className="wd-row">
              <span className="wd-label">Layout</span>
              <div className="chips">
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
                {/* layout_params survive preset switches (saveGallerySpace preserves them) */}
                <button
                  className={`chip chip-visual${row.layout === 'custom' ? ' active' : ''}`}
                  disabled={busy}
                  onClick={() => void setSpace({ layout: 'custom' })}
                >
                  <LayoutPlan layoutKey="custom" params={row.layout_params} className="chip-plan" />
                  Custom
                </button>
              </div>
            </div>
          </div>
          <p className="me-note" style={{ marginTop: '0.5rem' }}>
            The theme sets the room-wide design; the per-work controls above it apply to the
            selected work only, and matching the room&apos;s setting clears the override. Works are
            library assets — deleting a hakoniwa never deletes them.
          </p>
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
            <Hero />
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
