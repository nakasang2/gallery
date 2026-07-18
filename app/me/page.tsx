'use client'
// Dashboard: manage your hakoniwa (create / rename / publish / delete), profile, and links.
// Designed for multiple galleries; the release plan caps creation at PLAN.galleries.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useGallery } from '@/lib/store'
import { TEMPLATES, THEMES, LAYOUTS, normalizeDesignOverrides, normalizeLayoutParams, normalizeArrangement, type DesignOverrides, type CustomLayoutParams } from '@/lib/presets'
import { setOverride } from '@/lib/exhibition'
import { SIZE_GROUPS, matchPreset, presetByLabel } from '@/lib/artSizes'
import { ThemeSwatch, LayoutPlan, TemplateCard, WallPreview } from '@/components/SpacePreviews'
import WorkDesign from '@/components/WorkDesign'
import PurchaseModal from '@/components/PurchaseModal'
import PlacementEditor from '@/components/PlacementEditor'
import { LockIcon, VideoIcon } from '@/components/icons'
import {
  purchaseOptionsFor,
  capacityPurchaseOptions,
  designToolsPurchaseOptions,
  purchaseEyebrow,
  CAPACITY_ADDON_SIZE,
  PRICE_SINGLE_ITEM,
  PRICE_DESIGN_TOOLS,
} from '@/lib/pricing'
import { getEntitlements, isThemeUnlocked, isLayoutUnlocked, isTemplateUnlocked } from '@/lib/entitlements'
import { usePurchasedIds } from '@/lib/purchases'
import { useIsAdmin } from '@/lib/admin'
import { PLAN } from '@/lib/limits'
import {
  listMyGalleries,
  createGallery,
  updateGalleryDetails,
  deleteGallery,
  setGalleryPublic,
  setGalleryCover,
  saveGallerySpace,
  saveDesignOverrides,
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
  uploadLogo,
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

// The left-hand preview used by both settings sections (the room in section 1, the
// selected work in section 2): the real 3D render when there's a subject, else the 2D
// placeholder, plus an optional prompt when the section is empty.
function GalleryPreview({
  art,
  src,
  index,
  themeKey,
  frameKey,
  matKey,
  hangingKey,
  captionKey,
  designOverrides,
  emptyNote,
  mode = 'work',
}: {
  art: ArtworkData | undefined
  src: string | undefined
  index: number
  themeKey: string
  frameKey: string
  matKey: string
  hangingKey: string
  captionKey: string
  designOverrides: DesignOverrides
  emptyNote: string
  mode?: 'work' | 'room'
}) {
  return (
    <div className="we-left">
      {art && src ? (
        <div className="wall-preview3d">
          <Preview3D
            art={art.kind === 'video' ? { ...art, kind: 'image', src } : art}
            index={index}
            themeKey={themeKey}
            frameKey={frameKey}
            matKey={matKey}
            hangingKey={hangingKey}
            captionKey={captionKey}
            designOverrides={designOverrides}
            mode={mode}
          />
        </div>
      ) : (
        <WallPreview
          themeKey={themeKey}
          frameKey={frameKey}
          matKey={matKey}
          hangingKey={hangingKey}
          captionKey={captionKey}
          artSrc={src}
          artRatio={art?.ratio}
          designOverrides={designOverrides}
          className="wall-preview--lg"
        />
      )}
      {!art && <p className="me-note">{emptyNote}</p>}
    </div>
  )
}

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

// Design Tools (paid recolour/light/logo) is hidden for now to keep the settings panel
// simple — the code stays in place so it's a one-line flip to bring back. Typed `boolean`
// (not a literal) so the JSX inside still counts as "used".
const DESIGN_TOOLS_VISIBLE = false as boolean

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
  const owned = usePurchasedIds(user.id)
  const entitlements = getEntitlements(user.id, owned)
  const [step, setStep] = useState<1 | 2>(1)
  const [title, setTitle] = useState('')
  const [statement, setStatement] = useState('')
  // Start on the free template so a free user's default choice never uses paid content
  const [templateId, setTemplateId] = useState('studio')
  const [busy, setBusy] = useState(false)

  const selectedLocked = (() => {
    const t = TEMPLATES[templateId]
    return t ? !isTemplateUnlocked(t, entitlements) : false
  })()

  async function create() {
    // Defense in depth — the Continue button is already disabled for premium
    // templates, but never create a free gallery from paid content.
    const chosen = TEMPLATES[templateId]
    const safeTemplate = chosen && isTemplateUnlocked(chosen, entitlements) ? templateId : 'studio'
    setBusy(true)
    try {
      await createGallery(user.id, { title, templateId: safeTemplate, statement })
      await refreshMyGallery()
      // Persist the template locally too, so the editor's hydrate() can't fall back
      // to stale localStorage defaults after the client-side navigation
      const t = TEMPLATES[safeTemplate]
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
          {Object.keys(TEMPLATES).map((key) => {
            const t = TEMPLATES[key]
            return (
              <TemplateCard
                key={key}
                templateId={key}
                active={key === templateId}
                locked={!!t && !isTemplateUnlocked(t, entitlements)}
                onClick={() => setTemplateId(key)}
              />
            )
          })}
        </div>
        {selectedLocked ? (
          <>
            <button className="btn-line" disabled aria-disabled="true">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
                {TEMPLATES[templateId]?.label} is premium <LockIcon />
              </span>
            </button>
            <p className="me-note" style={{ marginTop: '0.5rem' }}>
              This template uses a paid theme or layout. Start from a free template now — you can buy and switch to it anytime after.
            </p>
          </>
        ) : (
          <button className="btn-line" onClick={() => setStep(2)}>
            Continue with {TEMPLATES[templateId]?.label} →
          </button>
        )}
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
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const [usernameInput, setUsernameInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState(row.title)
  const [statementInput, setStatementInput] = useState(row.statement)
  const [detailsState, setDetailsState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const detailsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [copied, setCopied] = useState(false)
  const [embedCopied, setEmbedCopied] = useState(false)
  const [showEmbed, setShowEmbed] = useState(false)
  const [stats, setStats] = useState<EngagementSummary | null>(null)
  const [uploading, setUploading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [titleInput, setTitleInput] = useState('')
  const [captionInput, setCaptionInput] = useState('')
  const [purchaseUrlInput, setPurchaseUrlInput] = useState('')
  const [priceInput, setPriceInput] = useState('')
  const [widthInput, setWidthInput] = useState('')
  const [heightInput, setHeightInput] = useState('')
  // The W×H cm fields only show in "custom" mode; a preset shows just the dropdown + swap.
  const [sizeCustom, setSizeCustom] = useState(false)
  const [mediumInput, setMediumInput] = useState('')
  const [workSaved, setWorkSaved] = useState(false)
  const [purchaseItem, setPurchaseItem] = useState<
    { kind: 'theme' | 'layout' | 'capacity' | 'design-tools'; key: string; label: string } | null
  >(null)
  const owned = usePurchasedIds(user.id)
  const entitlements = getEntitlements(user.id, owned)
  const [design, setDesign] = useState<DesignOverrides>(() => normalizeDesignOverrides(row.design_overrides))
  const [logoUploading, setLogoUploading] = useState(false)
  const designTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Manual slot placement (§11.13): local state seeded from the row (the source of
  // truth the dashboard reads), debounce-saved through the same path as theme/layout
  // so a placement edit and a layout change never race over one gallery row.
  const [placement, setPlacement] = useState<(string | null)[]>(() => normalizeArrangement(row.arrangement))
  const placeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Custom-layout knobs (width/depth/centre wall), editable right here in the dashboard.
  const [custom, setCustom] = useState<CustomLayoutParams>(() => normalizeLayoutParams(row.layout_params))
  const customTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Live preview of the size being edited: override the selected work's dimensions with the
  // current input values so the 3D preview follows the picker/typing immediately — before
  // Save, and independent of whether the DB has the 0025 columns yet.
  const previewArt = selected
    ? (() => {
        const w = parseFloat(widthInput)
        const h = parseFloat(heightInput)
        return {
          ...selected,
          widthCm: Number.isFinite(w) && w > 0 ? w : undefined,
          heightCm: Number.isFinite(h) && h > 0 ? h : undefined,
        }
      })()
    : undefined

  // The Theme section's preview shows the room itself, so it uses a stable subject — the
  // cover work (or the first) — rather than whichever work you're editing in the section
  // below, and the room's default framing rather than a per-work override.
  const roomArt = cloudArtworks.find((a) => a.id === row.cover_artwork_id) ?? cloudArtworks[0]
  const roomSrc = roomArt
    ? roomArt.kind === 'video'
      ? roomArt.poster
      : roomArt.poster ?? roomArt.src
    : undefined

  // The plate fields follow whichever work is selected
  useEffect(() => {
    setTitleInput(selected?.title ?? '')
    setCaptionInput(selected?.desc ?? '')
    setPurchaseUrlInput(selected?.purchaseUrl ?? '')
    setPriceInput(selected?.price ?? '')
    setWidthInput(selected?.widthCm ? String(selected.widthCm) : '')
    setHeightInput(selected?.heightCm ? String(selected.heightCm) : '')
    // Start in preset mode when the saved size matches a standard preset; otherwise
    // (a non-standard size, or none yet) open the custom fields so they're ready to type.
    setSizeCustom(matchPreset(selected?.widthCm, selected?.heightCm) === null)
    setMediumInput(selected?.medium ?? '')
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
  // Embeddable iframe: ?embed=1 trims the HUD to a back-link and opens outbound
  // links in a new tab. 16:10 keeps the walk usable in a blog's content column.
  const embedSrc = publicUrl ? `${publicUrl}?embed=1` : ''
  const embedCode = embedSrc
    ? `<iframe src="${embedSrc}" width="100%" height="600" style="border:0;border-radius:12px;aspect-ratio:16/10;max-width:100%" allowfullscreen loading="lazy" title="HAKONIWA — ${(isPlaceholderTitle(row.title) ? 'gallery' : row.title).replace(/"/g, '&quot;')}"></iframe>`
    : ''

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

  // Design Tools (§11.5/§11.8) — purely cosmetic, so this skips setSpace's
  // placement rebuild entirely. Debounced like the title/statement autosave:
  // colour pickers/sliders fire on every drag frame, not just on commit.
  function editDesign(partial: Partial<DesignOverrides>) {
    const next = { ...design, ...partial }
    setDesign(next)
    if (designTimer.current) clearTimeout(designTimer.current)
    designTimer.current = setTimeout(() => {
      saveDesignOverrides(row.id, next)
        .then(() => refreshMyGallery())
        .catch((e) => alert(`Could not save design: ${e instanceof Error ? e.message : e}`))
    }, 500)
  }
  useEffect(() => () => {
    if (designTimer.current) clearTimeout(designTimer.current)
  }, [])

  // Re-seed placement when the row's saved arrangement changes (e.g. after a save
  // round-trips, or another device edits it), but never mid-debounce clobber the map.
  useEffect(() => {
    setPlacement(normalizeArrangement(row.arrangement))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(row.arrangement)])

  // Manual placement autosave (§11.13): optimistic local update, then persist through
  // the same rowToSettings → saveGallerySpace(+rebuildPlacements) path as theme/layout.
  function editPlacement(next: (string | null)[]) {
    setPlacement(next)
    if (placeTimer.current) clearTimeout(placeTimer.current)
    placeTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const s = { ...rowToSettings(row, await mergedOverrides()), arrangement: next }
          await saveGallerySpace(row.id, s)
          if (row.is_public) await rebuildPlacements(row.id, s, cloudArtworks)
          await refreshMyGallery()
          onChanged()
        } catch (e) {
          alert(`Could not save placement: ${e instanceof Error ? e.message : e}`)
        }
      })()
    }, 700)
  }
  useEffect(() => () => {
    if (placeTimer.current) clearTimeout(placeTimer.current)
  }, [])

  // Custom layout size autosave: optimistic local update, then persist the layout_params
  // through the same saveGallerySpace(+rebuildPlacements) path. Debounced because the
  // sliders fire on every drag frame. Resizing changes the slot count, so public rooms
  // rebuild their placements.
  useEffect(() => {
    setCustom(normalizeLayoutParams(row.layout_params))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(row.layout_params)])
  function editCustom(partial: Partial<CustomLayoutParams>) {
    const next = normalizeLayoutParams({ ...custom, ...partial })
    setCustom(next)
    if (customTimer.current) clearTimeout(customTimer.current)
    customTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const s = { ...rowToSettings(row, await mergedOverrides()), layout: 'custom', layoutParams: next }
          await saveGallerySpace(row.id, s)
          if (row.is_public) await rebuildPlacements(row.id, s, cloudArtworks)
          await refreshMyGallery()
          onChanged()
        } catch (e) {
          alert(`Could not save the layout: ${e instanceof Error ? e.message : e}`)
        }
      })()
    }, 500)
  }
  useEffect(() => () => {
    if (customTimer.current) clearTimeout(customTimer.current)
  }, [])

  async function onLogoFile(file: File | undefined) {
    if (!file) return
    setLogoUploading(true)
    try {
      const url = await uploadLogo(user.id, row.id, file)
      editDesign({ logoUrl: url })
    } catch (e) {
      alert(`Logo upload failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLogoUploading(false)
    }
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
      const w = parseFloat(widthInput)
      const h = parseFloat(heightInput)
      await updateArtworkDetails(selected.id, {
        title: titleInput,
        description: captionInput,
        purchaseUrl: purchaseUrlInput,
        price: priceInput,
        widthCm: Number.isFinite(w) && w > 0 ? w : null,
        heightCm: Number.isFinite(h) && h > 0 ? h : null,
        medium: mediumInput,
      })
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
        {row.is_public && embedCode && (
          <button className="btn-line" onClick={() => setShowEmbed((v) => !v)}>
            {showEmbed ? 'Hide embed' : 'Embed'}
          </button>
        )}
        {row.is_public && username && (
          <a className="btn-line" href={`/@${username}/${row.slug}/catalog`} target="_blank" rel="noreferrer">
            Catalog (PDF)
          </a>
        )}
      </div>
      {row.is_public && embedCode && showEmbed && (
        <div className="embed-panel">
          <p className="me-note" style={{ marginTop: 0 }}>
            Paste this where you want the walkable gallery to appear — a blog post, a portfolio site, a Notion page.
          </p>
          <code className="embed-code">{embedCode}</code>
          <button
            className="btn-line btn-gold"
            onClick={() => {
              void navigator.clipboard.writeText(embedCode).then(() => {
                setEmbedCopied(true)
                setTimeout(() => setEmbedCopied(false), 1600)
              })
            }}
          >
            {embedCopied ? 'Copied' : 'Copy embed code'}
          </button>
        </div>
      )}
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

      {/* The room's editing surface: sticky 3D preview on the left, and on the right a
          single top-to-bottom flow — the room itself, the works hanging in it, then the
          selected work's own settings (Room ⊃ works). */}
      <div className="works-detail">
        <GalleryPreview
          art={roomArt}
          src={roomSrc}
          index={Math.max(0, cloudArtworks.indexOf(roomArt))}
          themeKey={row.theme}
          frameKey={row.frame_default}
          matKey={row.mat_default}
          hangingKey={row.hanging_default}
          captionKey={row.caption_default}
          designOverrides={design}
          emptyNote="Upload a work to see your theme's atmosphere."
          mode="room"
        />

        <div className="we-right">
          {/* Section 1 — the room's look: theme + layout. The 3D preview on the left
              recolours live as you switch theme. (Design Tools hidden for now.) */}
          <div className="wd-group wd-group--flush">
            <div className="wd-title"><span>Theme &amp; layout</span></div>
            <div className="wd-row">
              <span className="wd-label">Theme</span>
              <div className="chips">
                {Object.entries(THEMES).map(([key, def]) => {
                  const unlocked = isThemeUnlocked(key, entitlements)
                  return (
                    <button
                      key={key}
                      className={`chip chip-visual${key === row.theme ? ' active' : ''}${unlocked ? '' : ' locked'}`}
                      disabled={busy}
                      onClick={() => {
                        if (!unlocked) { setPurchaseItem({ kind: 'theme', key, label: def.label }); return }
                        void setSpace({ theme: key, ...def.recommends, mat: 'auto' })
                      }}
                    >
                      <ThemeSwatch themeKey={key} />
                      {def.label}
                      {!unlocked && <span className="chip-price-tag chip-lock-only" aria-hidden="true"><LockIcon /></span>}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="wd-row">
              <span className="wd-label">Layout</span>
              <div className="chips">
                {Object.entries(LAYOUTS).map(([key, def]) => {
                  const unlocked = isLayoutUnlocked(key, entitlements)
                  return (
                    <button
                      key={key}
                      className={`chip chip-visual${key === row.layout ? ' active' : ''}${unlocked ? '' : ' locked'}`}
                      disabled={busy}
                      onClick={() => {
                        if (!unlocked) { setPurchaseItem({ kind: 'layout', key, label: def.label }); return }
                        void setSpace({ layout: key })
                      }}
                    >
                      <LayoutPlan layoutKey={key} className="chip-plan" />
                      {def.label}
                      {!unlocked && <span className="chip-price-tag chip-lock-only" aria-hidden="true"><LockIcon /></span>}
                    </button>
                  )
                })}
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
            {row.layout === 'custom' && (
              <div className="wd-row wd-row-block">
                <span className="wd-label">Custom size</span>
                <div className="wd-block-body custom-size">
                  <label className="slider-row">
                    <span>Width {Math.round(custom.hw * 2)}m</span>
                    <input
                      type="range" min={8} max={18} step={0.5} value={custom.hw} disabled={busy}
                      onChange={(e) => editCustom({ hw: Number(e.target.value) })}
                    />
                  </label>
                  <label className="slider-row">
                    <span>Depth {Math.round(custom.hd * 2)}m</span>
                    <input
                      type="range" min={4} max={10} step={0.5} value={custom.hd} disabled={busy}
                      onChange={(e) => editCustom({ hd: Number(e.target.value) })}
                    />
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox" checked={custom.island} disabled={busy}
                      onChange={(e) => editCustom({ island: e.target.checked })}
                    />
                    Centre wall (4 extra slots)
                  </label>
                </div>
              </div>
            )}
            {cloudArtworks.length > 0 && (
              <div className="wd-row wd-row-block">
                <span className="wd-label">Placement</span>
                <div className="wd-block-body">
                  <p className="wd-sub">Choose which work hangs on each spot — leave gaps to space a small show out.</p>
                  <PlacementEditor
                    layoutKey={row.layout}
                    layoutParams={normalizeLayoutParams(row.layout_params)}
                    workCap={row.work_cap}
                    works={cloudArtworks}
                    arrangement={placement}
                    onChange={editPlacement}
                    disabled={busy}
                  />
                </div>
              </div>
            )}
          </div>

          {DESIGN_TOOLS_VISIBLE && (
          <>
          {/* Design Tools (§11.5/§11.8) — a buy-once capability layered on top of the
              theme: recolour walls/floor, tune the light mood, add a small logo mark.
              Hidden for now via DESIGN_TOOLS_VISIBLE. */}
          <div className="wd-group">
            <div className="wd-title"><span>Design Tools</span></div>
            {entitlements.designToolsEnabled ? (
              <>
                <div className="wd-row">
                  <span className="wd-label">Wall colour</span>
                  <div className="design-controls">
                    <input
                      type="color"
                      value={design.wall ?? hex((THEMES[row.theme] ?? THEMES.chic).wall)}
                      onChange={(e) => editDesign({ wall: e.target.value })}
                    />
                    {design.wall && (
                      <button className="btn-line" onClick={() => editDesign({ wall: null })}>Reset</button>
                    )}
                  </div>
                </div>
                <div className="wd-row">
                  <span className="wd-label">Floor colour</span>
                  <div className="design-controls">
                    <input
                      type="color"
                      value={design.floor ?? hex((THEMES[row.theme] ?? THEMES.chic).floorTint)}
                      onChange={(e) => editDesign({ floor: e.target.value })}
                    />
                    {design.floor && (
                      <button className="btn-line" onClick={() => editDesign({ floor: null })}>Reset</button>
                    )}
                  </div>
                </div>
                <div className="wd-row">
                  <span className="wd-label">Light colour</span>
                  <div className="design-controls">
                    <input
                      type="color"
                      value={design.lightColor ?? hex((THEMES[row.theme] ?? THEMES.chic).spotColor)}
                      onChange={(e) => editDesign({ lightColor: e.target.value })}
                    />
                    {design.lightColor && (
                      <button className="btn-line" onClick={() => editDesign({ lightColor: null })}>Reset</button>
                    )}
                  </div>
                </div>
                <div className="wd-row">
                  <span className="wd-label">Light mood</span>
                  <div className="design-controls">
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      value={design.lightIntensity ?? 1}
                      onChange={(e) => editDesign({ lightIntensity: Number(e.target.value) })}
                    />
                    <span className="design-value">{Math.round((design.lightIntensity ?? 1) * 100)}%</span>
                    {design.lightIntensity != null && (
                      <button className="btn-line" onClick={() => editDesign({ lightIntensity: null })}>Reset</button>
                    )}
                  </div>
                </div>
                <div className="wd-row">
                  <span className="wd-label">Logo</span>
                  <div className="design-controls">
                    {design.logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={design.logoUrl} alt="" className="design-logo-preview" />
                    )}
                    <label className="btn-line file-btn" aria-disabled={logoUploading} style={{ marginTop: 0 }}>
                      {logoUploading ? 'Uploading…' : design.logoUrl ? 'Change logo' : 'Upload logo'}
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={logoUploading}
                        onChange={(e) => {
                          void onLogoFile(e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                    </label>
                    {design.logoUrl && (
                      <button className="btn-line" onClick={() => editDesign({ logoUrl: null })}>Remove</button>
                    )}
                  </div>
                </div>
                <p className="me-note" style={{ marginTop: '0.3rem' }}>
                  These sit on top of your theme — switching themes later keeps every override here.
                </p>
              </>
            ) : (
              <div className="dt-teaser">
                <div className="swatch-strip" aria-hidden="true">
                  <span style={{ background: hex((THEMES[row.theme] ?? THEMES.chic).wall) }} />
                  <span style={{ background: hex((THEMES[row.theme] ?? THEMES.chic).floorTint) }} />
                  <span style={{ background: hex((THEMES[row.theme] ?? THEMES.chic).spotColor) }} />
                </div>
                <div className="dt-teaser-copy">
                  <p className="dt-teaser-title">Recolour the room, tune the light, add your logo</p>
                  <p className="dt-teaser-sub">One-time unlock — works in this room and every room after</p>
                </div>
                <button
                  className="dt-teaser-cta"
                  onClick={() => setPurchaseItem({ kind: 'design-tools', key: 'design-tools', label: 'Design Tools' })}
                >
                  Unlock — {PRICE_DESIGN_TOOLS}
                </button>
              </div>
            )}
          </div>
          </>
          )}
        </div>
      </div>

      {/* ===== Section 2 — the artworks that hang in this room ===== */}
      <div className="art-section">
        {/* Full-width strip: every work in the room side by side. Pick one to edit it in
            the two-column detail (preview + settings) below. */}
        <div className="works-in-room">
          <div className="wd-title">
            <span>Works in this room</span>
            <span className="wd-title-meta">{cloudArtworks.length} / {row.work_cap}</span>
          </div>
            {cloudArtworks.length === 0 ? (
              <label className="upload-hero" aria-disabled={uploading}>
                <b>{uploading ? 'Uploading…' : 'Hang your first work'}</b>
                <span>Drop in images from your camera roll or portfolio — the preview shows them framed on your wall.</span>
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
                <p className="wd-sub" style={{ marginBottom: '0.5rem' }}>Tap a work to edit it · ★ cover · × remove</p>
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
                      <figcaption>
                        {art.kind === 'video' ? (
                          <>
                            <VideoIcon className="works-title-icon" /> {art.title}
                          </>
                        ) : (
                          art.title
                        )}
                      </figcaption>
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
                  {Array.from({ length: Math.max(0, row.work_cap - cloudArtworks.length) }).map((_, i) => (
                    <label className="works-add" key={`add-${i}`} aria-disabled={uploading} title="Upload a work">
                      <span className="works-add-box" aria-hidden="true">{uploading ? '…' : '+'}</span>
                      <span className="works-add-label">Slot {cloudArtworks.length + i + 1}</span>
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
                  ))}
                  <button
                    className="works-capacity"
                    onClick={() => setPurchaseItem({ kind: 'capacity', key: 'capacity', label: `+${CAPACITY_ADDON_SIZE} works` })}
                    title={`Add ${CAPACITY_ADDON_SIZE} more work slots`}
                  >
                    <span className="works-capacity-box" aria-hidden="true">
                      <LockIcon /> +{CAPACITY_ADDON_SIZE}
                    </span>
                    <span className="works-capacity-label">more slots</span>
                  </button>
                </div>
              </>
            )}
        </div>

        {/* Two columns: the selected work's 3D preview (left) + its settings (right) */}
        {selected && (
          <div className="works-detail">
            <GalleryPreview
              art={previewArt}
              src={previewSrc}
              index={selectedIndex}
              themeKey={row.theme}
              frameKey={frame}
              matKey={mat}
              hangingKey={hanging}
              captionKey={captionKey}
              designOverrides={design}
              emptyNote="Pick a work above to preview it framed on your wall."
            />
            <div className="we-right">
              {/* The name plate's text: title + caption, straight onto the plate above.
                  Flush (no top divider) — it's the first thing in the settings column now. */}
              <div className="wd-group wd-group--flush">
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
                <label className="me-field" style={{ margin: '0.45rem 0' }}>
                  <span>Price — shown to visitors (type it with its currency)</span>
                  <input
                    type="text"
                    placeholder="e.g. ¥50,000 (leave blank to hide)"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                  />
                </label>
                <label className="me-field" style={{ margin: '0.45rem 0' }}>
                  <span>Purchase link — where “Available for purchase” sends buyers</span>
                  <input
                    type="text"
                    inputMode="url"
                    placeholder="yourshop.com/this-piece (leave blank if not for sale)"
                    value={purchaseUrlInput}
                    onChange={(e) => setPurchaseUrlInput(e.target.value)}
                  />
                </label>
                <div className="wd-row" style={{ margin: '0.45rem 0' }}>
                  <span className="wd-label">Size</span>
                  <div className="design-controls" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                    {/* Pick a standard size (号 / A / B), or "Custom" to type cm. The W×H
                        fields only appear in custom mode; a preset shows just the ⇄ swap. */}
                    <select
                      className="ent-select"
                      value={sizeCustom ? 'custom' : (matchPreset(parseFloat(widthInput), parseFloat(heightInput)) ?? 'custom')}
                      onChange={(e) => {
                        const p = presetByLabel(e.target.value)
                        if (p) {
                          setWidthInput(String(p.w))
                          setHeightInput(String(p.h))
                          setSizeCustom(false)
                        } else {
                          setSizeCustom(true) // "Custom / other…" — reveal the cm fields
                        }
                      }}
                    >
                      <option value="custom">Custom / other…</option>
                      {SIZE_GROUPS.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.options.map((o) => (
                            <option key={o.label} value={o.label}>
                              {o.label} — {o.w} × {o.h} cm
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'nowrap' }}>
                      {sizeCustom && (
                        <>
                          <input
                            type="number"
                            min={1}
                            inputMode="decimal"
                            placeholder="W"
                            className="size-num"
                            value={widthInput}
                            onChange={(e) => setWidthInput(e.target.value)}
                          />
                          <span aria-hidden="true" style={{ color: 'var(--muted)' }}>×</span>
                          <input
                            type="number"
                            min={1}
                            inputMode="decimal"
                            placeholder="H"
                            className="size-num"
                            value={heightInput}
                            onChange={(e) => setHeightInput(e.target.value)}
                          />
                          <span aria-hidden="true" style={{ color: 'var(--muted)' }}>cm</span>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn-line"
                        title="Swap width and height (portrait ⇄ landscape)"
                        style={{ padding: '0.35em 0.6em' }}
                        onClick={() => {
                          setWidthInput(heightInput)
                          setHeightInput(widthInput)
                        }}
                      >
                        ⇄
                      </button>
                    </div>
                  </div>
                </div>
                <label className="me-field" style={{ margin: '0.45rem 0' }}>
                  <span>Medium — e.g. “Oil on canvas”, “Giclée print”</span>
                  <input
                    type="text"
                    placeholder="Medium (optional)"
                    value={mediumInput}
                    onChange={(e) => setMediumInput(e.target.value)}
                  />
                </label>
                {/* Audio guide needs no upload UI — the tour reads the caption aloud
                    automatically (text-to-speech). */}
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
            </div>
          </div>
        )}
      </div>

      {/* Save the selected work's plate/size/framing. Frame/mat/hanging autosave on pick,
          but the text fields don't — so this stays docked to the bottom of the viewport
          (position: sticky) and only releases into normal flow at the end of the page, so
          it's reachable without scrolling the whole panel. */}
      {selected && (
        <button
          className="wd-save-cta wd-save-sticky"
          disabled={
            busy ||
            (titleInput === selected.title &&
              captionInput === (selected.desc ?? '') &&
              purchaseUrlInput === (selected.purchaseUrl ?? '') &&
              priceInput === (selected.price ?? '') &&
              widthInput === (selected.widthCm ? String(selected.widthCm) : '') &&
              heightInput === (selected.heightCm ? String(selected.heightCm) : '') &&
              mediumInput === (selected.medium ?? ''))
          }
          onClick={() => void saveWorkDetails()}
        >
          {workSaved ? 'Saved ✓' : 'Save settings'}
        </button>
      )}
      {purchaseItem && (
        <PurchaseModal
          itemLabel={purchaseItem.label}
          eyebrow={purchaseEyebrow(purchaseItem.kind)}
          preview={
            purchaseItem.kind === 'theme' ? (
              <WallPreview
                themeKey={purchaseItem.key}
                frameKey={(THEMES[purchaseItem.key] ?? THEMES.chic).recommends.frame}
                hangingKey={(THEMES[purchaseItem.key] ?? THEMES.chic).recommends.hanging}
                captionKey={(THEMES[purchaseItem.key] ?? THEMES.chic).recommends.caption}
                artSrc={previewSrc}
                artRatio={selected?.ratio}
                className="purchase-wall-preview"
              />
            ) : purchaseItem.kind === 'layout' ? (
              <LayoutPlan layoutKey={purchaseItem.key} className="purchase-plan-preview" />
            ) : purchaseItem.kind === 'design-tools' ? (
              <div className="swatch-strip" aria-hidden="true">
                <span style={{ background: hex((THEMES[row.theme] ?? THEMES.chic).wall) }} />
                <span style={{ background: hex((THEMES[row.theme] ?? THEMES.chic).floorTint) }} />
                <span style={{ background: hex((THEMES[row.theme] ?? THEMES.chic).spotColor) }} />
              </div>
            ) : undefined
          }
          options={
            purchaseItem.kind === 'capacity'
              ? capacityPurchaseOptions()
              : purchaseItem.kind === 'design-tools'
                ? designToolsPurchaseOptions()
                : purchaseOptionsFor(purchaseItem.kind, purchaseItem.label)
          }
          previewNote={
            purchaseItem.kind === 'capacity'
              ? 'This is a preview of how buying more room capacity will work.'
              : purchaseItem.kind === 'design-tools'
                ? 'This is a preview of how unlocking Design Tools will work.'
                : undefined
          }
          intent={{
            kind: purchaseItem.kind,
            itemKey: purchaseItem.kind === 'theme' || purchaseItem.kind === 'layout' ? purchaseItem.key : '',
            galleryId: purchaseItem.kind === 'capacity' ? row.id : undefined,
          }}
          onClose={() => setPurchaseItem(null)}
        />
      )}
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
  const [snsX, setSnsX] = useState('')
  const [snsInstagram, setSnsInstagram] = useState('')
  const [snsWebsite, setSnsWebsite] = useState('')
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
        setSnsX(p.sns.x)
        setSnsInstagram(p.sns.instagram)
        setSnsWebsite(p.sns.website)
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
      await saveProfile(user.id, {
        displayName,
        bio,
        sns: { x: snsX, instagram: snsInstagram, website: snsWebsite },
      })
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
      <p className="me-field-group-label">
        Link your SNS — shown on your public page and while visitors walk your room, so they can follow you elsewhere.
      </p>
      <label className="me-field">
        <span>X (Twitter) handle</span>
        <div className="field-row" style={{ marginTop: 0 }}>
          <span className="field-prefix">@</span>
          <input
            type="text"
            placeholder="yourhandle"
            value={snsX}
            onChange={(e) => setSnsX(e.target.value.replace(/^@/, ''))}
          />
        </div>
      </label>
      <label className="me-field">
        <span>Instagram handle</span>
        <div className="field-row" style={{ marginTop: 0 }}>
          <span className="field-prefix">@</span>
          <input
            type="text"
            placeholder="yourhandle"
            value={snsInstagram}
            onChange={(e) => setSnsInstagram(e.target.value.replace(/^@/, ''))}
          />
        </div>
      </label>
      <label className="me-field">
        <span>Website / portfolio</span>
        <input
          type="text"
          placeholder="yoursite.com"
          value={snsWebsite}
          onChange={(e) => setSnsWebsite(e.target.value)}
        />
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

  const isAdmin = useIsAdmin(user?.id ?? null)
  const [tab, setTab] = useState<MeTab>('gallery')
  const [checked, setChecked] = useState(false)
  // null = still loading (prevents flashing the create card at returning users)
  const [galleries, setGalleries] = useState<GalleryRow[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [usage, setUsage] = useState<number | null>(null)
  // Set when Stripe Checkout sent the user back here (?purchase=success|cancelled)
  const [purchaseReturn, setPurchaseReturn] = useState<'success' | 'cancelled' | null>(null)

  useEffect(() => {
    hydrate() // frameOverrides etc. from this browser feed placement rebuilds
    initAuth()
    supabase?.auth.getSession().then(() => setChecked(true))
    // Checkout return: show the banner once and strip the param so a reload
    // doesn't re-announce an old purchase
    const params = new URLSearchParams(window.location.search)
    const purchase = params.get('purchase')
    if (purchase === 'success' || purchase === 'cancelled') {
      setPurchaseReturn(purchase)
      window.history.replaceState(null, '', '/me')
    }
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

  // The webhook (not the redirect) is what grants the purchase, and it can land
  // a few seconds after the buyer returns — refetch once more shortly after so
  // the new capacity/ownership shows up without a manual refresh
  useEffect(() => {
    if (purchaseReturn !== 'success') return
    const timer = setTimeout(() => void reload(), 4000)
    return () => clearTimeout(timer)
  }, [purchaseReturn, reload])

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
            <Link className="btn-line" href="/explore">Explore</Link>
            {isAdmin && (
              <Link className="btn-line btn-gold" href="/admin">Admin</Link>
            )}
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
            {purchaseReturn && (
              <div className={`me-card purchase-return${purchaseReturn === 'success' ? ' ok' : ''}`} role="status">
                <p className="me-note" style={{ margin: 0 }}>
                  {purchaseReturn === 'success'
                    ? 'Payment received — your upgrade unlocks in a few seconds. If it doesn’t appear, refresh this page.'
                    : 'Checkout cancelled — nothing was charged.'}
                </p>
                <button className="btn-line" onClick={() => setPurchaseReturn(null)}>Dismiss</button>
              </div>
            )}
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
