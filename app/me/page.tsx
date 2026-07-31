'use client'
// Dashboard: manage your gallery (create / rename / publish / delete), profile, and links.
// Designed for multiple galleries; the release plan caps creation at PLAN.galleries.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { useGallery } from '@/lib/store'
import { TEMPLATES, THEMES, LAYOUTS, CUSTOM_LAYOUT_RELEASED, normalizeDesignOverrides, normalizeLayoutParams, normalizeArrangement, type DesignOverrides, type CustomLayoutParams } from '@/lib/presets'
import { setOverride } from '@/lib/exhibition'
import { SIZE_GROUPS, matchPreset, presetByLabel } from '@/lib/artSizes'
import { ThemeSwatch, LayoutPlan, TemplateCard, WallPreview } from '@/components/SpacePreviews'
import WorkDesign from '@/components/WorkDesign'
import PlacementEditor from '@/components/PlacementEditor'
import PurchaseModal from '@/components/PurchaseModal'
import TopActions from '@/components/TopActions'
import { LockIcon, VideoIcon, InfoIcon, CopyIcon, CheckIcon } from '@/components/icons'
import { PRICE_SLOT, PRICE_PER_SLOT_CENTS, type PaidKind } from '@/lib/pricing'
import { getEntitlements, isThemeUnlocked, isLayoutUnlocked, isTemplateUnlocked, unlockedFirst } from '@/lib/entitlements'
import { usePurchasedIds } from '@/lib/purchases'
import { useIsAdmin } from '@/lib/admin'
import { PLAN, MAX_WORKS_PER_ROOM, GALLERY_BGM_MAX_BYTES } from '@/lib/limits'
import {
  listMyGalleries,
  createGallery,
  updateGalleryDetails,
  deleteGallery,
  setGalleryPublic,
  setGalleryCover,
  saveGallerySpace,
  saveDesignOverrides,
  saveGalleryBgm,
  saveGuestbookEnabled,
  rebuildPlacements,
  fetchPlacementOverrides,
  rowToSettings,
  EMPTY_OVERRIDES,
  type PlacementOverrides,
  type GalleryRow,
} from '@/lib/galleries'
import { getProfile, saveProfile, setUsername, isPlaceholderTitle, USERNAME_RE } from '@/lib/publish'
import { SNS_PLATFORMS, type CustomLink } from '@/lib/sns'
import { BRAND_ICONS, GlobeIcon } from '@/components/BrandIcons'
import {
  getStorageUsage,
  uploadArtwork,
  uploadAvatar,
  uploadLogo,
  uploadGalleryBgm,
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
import { loadImage } from '@/lib/upload'
import type { ArtworkData } from '@/lib/artworks'
import AuthShell from '@/components/auth/AuthShell'
import { LegalLink, LocaleLink, useT } from '@/components/I18nProvider'

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
  const t = useT()
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

const IMPORT_DISMISS_KEY = 'xibit360.importDismissed.v1'

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

// Design Tools (paid recolour/light/logo) is hidden for now to keep the settings panel
// simple — the code stays in place so it's a one-line flip to bring back. Typed `boolean`
// (not a literal) so the JSX inside still counts as "used".
// Titles are drawn onto fixed-size canvases (the name plate and the title wall).
// They now shrink and wrap to fit, but a title still has to be a title — and one
// Japanese character is as wide as two Latin ones, so the cap is deliberately
// tighter than it looks (components/gallery/textures.ts).
const TITLE_MAX = 60

const DESIGN_TOOLS_VISIBLE = false as boolean

// A field label kept to one or two words, with the "why/how" moved into an info
// bubble beside it — hover on desktop, tap (focus) on touch. Keeps the form scannable
// instead of every input carrying a sentence. `hint` is the explanatory text.
function FieldLabel({ children, hint }: { children: string; hint: string }) {
  const t = useT()
  return (
    <span className="me-field-label">
      {children}
      {/* A span, not a <button>: a button is a "labelable" element, so nesting one
          before the input inside a <label> hijacks the label's association away from
          the field. tabIndex keeps it keyboard-reachable; the tooltip shows on
          :hover / :focus / :focus-within (see .field-hint in me.css). */}
      <span className="field-hint" tabIndex={0} role="note" aria-label={hint}>
        <InfoIcon />
        <span className="field-hint-pop" role="tooltip">{hint}</span>
      </span>
    </span>
  )
}

// Dashboard-wide "Saved" toast. Everything autosaves, so a single transient toast is
// the shared confirmation: any save success calls toast(). Provided by MePage.
const ToastContext = createContext<(msg?: string) => void>(() => {})
function useToast() {
  return useContext(ToastContext)
}


// The first thing a signed-in artist sees: their own face and name, not a form
function Hero() {
  const t = useT()
  const user = useGallery((s) => s.user)!
  const displayName = useGallery((s) => s.profileDisplayName)
  const avatarUrl = useGallery((s) => s.profileAvatarUrl)
  const username = useGallery((s) => s.profileUsername)
  const name = displayName || user.displayName
  const h = new Date().getHours()
  const greet =
    h < 5 ? t('me.greetLate') : h < 11 ? t('me.greetMorning') : h < 18 ? t('me.greetAfternoon') : t('me.greetEvening')
  return (
    <div className="me-hero">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img crossOrigin="anonymous" className="me-hero-avatar" src={avatarUrl} alt="" />
      ) : (
        <div className="me-hero-avatar empty">{name.slice(0, 1).toUpperCase()}</div>
      )}
      <div>
        <div className="me-hero-greet">{greet}, {name}.</div>
        <p className="me-hero-sub">
          {username ? (
            <>
              {t('me.livesAt')}{' '}
              <a href={`/@${username}`} target="_blank" rel="noreferrer">/@{username}</a>
            </>
          ) : (
            t('me.pickUsernameHint')
          )}
        </p>
      </div>
    </div>
  )
}

// Guest migration (REQUIREMENTS 10.1): offer to move this browser's local works into the account
function GuestImportCard() {
  const t = useT()
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
    if (failed) alert(t('me.importPartial', { ok, failed }))
  }

  return (
    <div className="me-card" style={{ marginBottom: '1rem' }}>
      <p className="me-note" style={{ marginTop: 0 }}>
        {t('me.importTitle', { count: localArtworks.length })}{' '}
        {t('me.importBody', { count: localArtworks.length })}
      </p>
      <div className="hako-actions" style={{ marginTop: '0.8rem' }}>
        <button className="btn-line" disabled={busy} onClick={() => void importAll()}>
          {busy ? t('me.importing') : t('me.importToAccount')}
        </button>
        <button className="btn-line" disabled={busy} onClick={dismiss}>{t('me.importNotNow')}</button>
      </div>
    </div>
  )
}

// Create a gallery as a two-step wizard: SEE the template first, then name it,
// and land straight in the editor with the themed room around you (REQUIREMENTS 10.2)
function CreateCard({ onCreated }: { onCreated: () => void }) {
  const t = useT()
  const user = useGallery((s) => s.user)!
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const updateSettings = useGallery((s) => s.updateSettings)
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
          lightOverrides: {},
        })
      }
      // Land on the dashboard's works stage, not the empty 3D room — the next
      // step ("add your first work") is visible there (DECISIONS 2026-07-30).
      onCreated()
    } catch (e) {
      alert(t('me.createFailed', { msg: String(e instanceof Error ? e.message : e) }))
      setBusy(false)
    }
  }

  if (step === 1) {
    return (
      <div className="me-card">
        <p className="me-note" style={{ marginTop: 0 }}>
          <b style={{ color: 'var(--ink)' }}>{t('me.createStep1')}</b> {t('me.createStep1Note')}
        </p>
        {/* One preview per card (the card top IS the wall preview) — no duplicate block */}
        <div className="tpl-grid">
          {unlockedFirst(Object.keys(TEMPLATES), (key) => {
            const tpl = TEMPLATES[key]
            return !tpl || isTemplateUnlocked(tpl, entitlements)
          }).map((key) => {
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
                {t('me.createTemplatePremium', { name: TEMPLATES[templateId]?.label ?? '' })} <LockIcon />
              </span>
            </button>
            <p className="me-note" style={{ marginTop: '0.5rem' }}>
              {t('me.createLocked')}
            </p>
          </>
        ) : (
          <button className="btn-line" onClick={() => setStep(2)}>
            {t('me.createContinue')} — {TEMPLATES[templateId]?.label} →
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="me-card">
      <p className="me-note" style={{ marginTop: 0 }}>
        <b style={{ color: 'var(--ink)' }}>{t('me.createStep2')}</b> {t('me.createStep2Note')}
      </p>
      <label className="me-field">
        <span>{t('me.titleOptional')}</span>
        <input
          type="text"
          placeholder={t('me.titlePlaceholder')}
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </label>
      <label className="me-field">
        <span>{t('me.statementOptional')}</span>
        <textarea
          rows={3}
          maxLength={200}
          placeholder={t('me.statementPlaceholder')}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
        />
      </label>
      <div className="hako-actions">
        <button className="btn-line" disabled={busy} onClick={() => setStep(1)}>← {t('me.createBack')}</button>
        <button className="btn-line" disabled={busy} onClick={() => void create()}>
          {busy ? t('common.saving') : t('me.createOpen')}
        </button>
      </div>
    </div>
  )
}

// The gallery card IS the gallery workbench: status + publish on top, then the
// works library on the left and the real-3D preview with every design control —
// per-work title/caption/frame and the room-wide theme/layout — on the right.
function GalleryCard({ row, onChanged }: { row: GalleryRow; onChanged: () => void }) {
  const t = useT()
  const user = useGallery((s) => s.user)!
  const username = useGallery((s) => s.profileUsername)
  const cloudArtworks = useGallery((s) => s.cloudArtworks)
  const frameOverrides = useGallery((s) => s.frameOverrides)
  const matOverrides = useGallery((s) => s.matOverrides)
  const hangingOverrides = useGallery((s) => s.hangingOverrides)
  const captionOverrides = useGallery((s) => s.captionOverrides)
  const lightOverrides = useGallery((s) => s.lightOverrides)
  const updateSettings = useGallery((s) => s.updateSettings)
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const toast = useToast()
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
  // The stage tabs are the ONLY navigation now (the old top-level gallery/guestbook/
  // profile tabs are gone — ユーザー指示 2026-07-30). The publish flow (works → room →
  // placement → publish) leads, then the two housekeeping stages (guestbook, profile).
  // Order is visible but never enforced — every stage stays reachable.
  type Stage = 'works' | 'room' | 'placement' | 'publish' | 'profile'
  const [stage, setStage] = useState<Stage>('works')
  // The work being edited in the shared editor sheet (works + placement stages).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Phones render the editor sheet as a bottom sheet over the grid/map.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)')
    const apply = () => setNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  const [titleInput, setTitleInput] = useState('')
  const [captionInput, setCaptionInput] = useState('')
  const [purchaseUrlInput, setPurchaseUrlInput] = useState('')
  const [priceInput, setPriceInput] = useState('')
  const [widthInput, setWidthInput] = useState('')
  const [heightInput, setHeightInput] = useState('')
  // The W×H cm fields only show in "custom" mode; a preset shows just the dropdown + swap.
  const [sizeCustom, setSizeCustom] = useState(false)
  const [mediumInput, setMediumInput] = useState('')
  // Per-work text autosaves (like the exhibition title/statement) — no Save button.
  const [workState, setWorkState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [purchaseItem, setPurchaseItem] = useState<
    // `qty` is only read in capacity mode: tapping a locked spot on the placement
    // map knows how many slots it takes to reach that spot, so the stepper opens
    // on that number instead of 1.
    { kind: PaidKind | 'capacity'; key: string; label: string; qty?: number } | null
  >(null)
  const owned = usePurchasedIds(user.id)
  const entitlements = getEntitlements(user.id, owned)
  const [design, setDesign] = useState<DesignOverrides>(() => normalizeDesignOverrides(row.design_overrides))
  const [logoUploading, setLogoUploading] = useState(false)
  // Ambient BGM (§P3-12): the gallery row's bgm_url is the source of truth; mirror it locally
  const [bgmUrl, setBgmUrl] = useState<string | null>(row.bgm_url ?? null)
  const [bgmBusy, setBgmBusy] = useState(false)
  const designTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Manual slot placement (§11.13): local state seeded from the row (the source of
  // truth the dashboard reads), debounce-saved through the same path as theme/layout
  // so a placement edit and a layout change never race over one gallery row.
  const [placement, setPlacement] = useState<(string | null)[]>(() => normalizeArrangement(row.arrangement))
  const placeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Every local placement edit bumps editGen; a save stamps savedGen with the gen it
  // persisted. While editGen ≠ savedGen there's an unsaved (or in-flight) local edit, so
  // the re-seed effect must not overwrite the map from the row — otherwise a save's row
  // refresh reverts a drop the user made during its round-trip (a boolean "dirty" flag
  // fails here: an earlier save's completion would clear it while a newer edit is pending).
  const editGen = useRef(0)
  const savedGen = useRef(0)
  // Custom-layout knobs (width/depth/centre wall), editable right here in the dashboard.
  const [custom, setCustom] = useState<CustomLayoutParams>(() => normalizeLayoutParams(row.layout_params))
  const customTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selected = selectedId ? cloudArtworks.find((a) => a.id === selectedId) : undefined
  const selectedIndex = selected ? cloudArtworks.indexOf(selected) : 0

  // Effective per-work design: the override when set, else the gallery default
  const frame = (selected && frameOverrides[selected.id]) || row.frame_default
  const mat = (selected && matOverrides[selected.id]) || row.mat_default
  const hanging = (selected && hangingOverrides[selected.id]) || row.hanging_default
  const captionKey = (selected && captionOverrides[selected.id]) || row.caption_default
  // Effective lighting for the selected work: 'follow' means the room's default.
  const lightKey = (() => {
    const k = selected ? lightOverrides[selected.id] : undefined
    return k === 'ceiling' || k === 'overhead' ? k : 'follow'
  })()
  // The 3D preview reads lightMode from designOverrides, so resolve the per-work
  // override into the copy the preview gets — tapping a lighting chip must be
  // visible immediately (DECISIONS 2026-07-30).
  const selectedDesign: DesignOverrides =
    lightKey === 'follow' ? design : { ...design, lightMode: lightKey }
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

  // If the edited work is deleted (here or on another device), close the sheet
  useEffect(() => {
    if (selectedId && !cloudArtworks.some((a) => a.id === selectedId)) setSelectedId(null)
  }, [selectedId, cloudArtworks])

  // The works stage always has one work under the editor, so its fields are visible
  // without hunting for what to tap first (ユーザー指示 2026-07-30). The placement
  // stage does NOT pre-select: there you pick a spot on the map.
  useEffect(() => {
    if (stage !== 'works') return
    if (selectedId && cloudArtworks.some((a) => a.id === selectedId)) return
    setSelectedId(cloudArtworks[0]?.id ?? null)
  }, [stage, cloudArtworks, selectedId])

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
    setWorkState('idle')
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
          setDetailsState('idle')
          toast()
        })
        .catch((e) => {
          alert(t('me.saveDetailsFailed', { msg: String(e instanceof Error ? e.message : e) }))
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

  // The shareable URL is just /@name while the plan allows one gallery
  // (the slug mechanism stays in the DB for the multi-gallery future)
  const publicUrl = typeof window !== 'undefined' && username ? `${location.origin}/@${username}` : ''
  // Embeddable iframe: ?embed=1 trims the HUD to a back-link and opens outbound
  // links in a new tab. 16:10 keeps the walk usable in a blog's content column.
  const embedSrc = publicUrl ? `${publicUrl}?embed=1` : ''
  const embedCode = embedSrc
    ? `<iframe src="${embedSrc}" width="100%" height="600" style="border:0;border-radius:12px;aspect-ratio:16/10;max-width:100%" allowfullscreen loading="lazy" title="Xibit360 — ${(isPlaceholderTitle(row.title) ? t('me.embedFallbackTitle') : row.title).replace(/"/g, '&quot;')}"></iframe>`
    : ''

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      await refreshMyGallery()
      onChanged()
      toast()
    } catch (e) {
      alert(t('me.actionFailed', { label, msg: String(e instanceof Error ? e.message : e) }))
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
      lights: { ...saved.lights, ...lightOverrides },
    }
  }

  async function togglePublic() {
    if (!row.is_public && cloudArtworks.length === 0) {
      alert(t('me.needWorkAlert'))
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
        .then(() => {
          void refreshMyGallery()
          toast()
        })
        .catch((e) => alert(t('me.saveDesignFailed', { msg: String(e instanceof Error ? e.message : e) })))
    }, 500)
  }
  useEffect(() => () => {
    if (designTimer.current) clearTimeout(designTimer.current)
  }, [])

  // Re-seed placement when the row's saved arrangement changes (another device edits it,
  // or our own save round-trips), but never clobber an unsaved/in-flight local edit — a
  // drag the user made while a save was in flight must survive that save's row refresh.
  useEffect(() => {
    if (editGen.current !== savedGen.current) return
    setPlacement(normalizeArrangement(row.arrangement))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(row.arrangement)])

  // Manual placement autosave (§11.13): optimistic local update, then persist through
  // the same rowToSettings → saveGallerySpace(+rebuildPlacements) path as theme/layout.
  function editPlacement(next: (string | null)[]) {
    const gen = ++editGen.current
    setPlacement(next)
    if (placeTimer.current) clearTimeout(placeTimer.current)
    placeTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const s = { ...rowToSettings(row, await mergedOverrides()), arrangement: next }
          await saveGallerySpace(row.id, s)
          if (row.is_public) await rebuildPlacements(row.id, s, cloudArtworks)
          // Stamp BEFORE the row refresh: this gen is now the persisted truth, so if no
          // newer edit arrived the re-seed may adopt the refreshed row.
          savedGen.current = gen
          await refreshMyGallery()
          onChanged()
          toast()
        } catch (e) {
          alert(t('me.savePlacementFailed', { msg: String(e instanceof Error ? e.message : e) }))
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
          toast()
        } catch (e) {
          alert(t('me.saveLayoutFailed', { msg: String(e instanceof Error ? e.message : e) }))
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
      alert(t('me.logoUploadFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      setLogoUploading(false)
    }
  }

  async function onBgmFile(file: File | undefined) {
    if (!file) return
    setBgmBusy(true)
    try {
      const url = await uploadGalleryBgm(user.id, row.id, file)
      await saveGalleryBgm(row.id, url)
      setBgmUrl(url)
      onChanged()
      toast()
    } catch (e) {
      alert(t('me.bgmUploadFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      setBgmBusy(false)
    }
  }

  async function removeBgm() {
    setBgmBusy(true)
    try {
      await saveGalleryBgm(row.id, null)
      setBgmUrl(null)
      onChanged()
      toast()
    } catch (e) {
      alert(t('me.bgmRemoveFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      setBgmBusy(false)
    }
  }

  // Publishing needs a username — set it right here instead of hunting for the Profile section
  async function saveUsernameInline() {
    const name = usernameInput.trim().toLowerCase()
    if (!USERNAME_RE.test(name)) {
      alert(t('me.usernameRules'))
      return
    }
    setBusy(true)
    try {
      await setUsername(user.id, name)
      await refreshCloud()
      toast()
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
          alert(t('me.videoFromRoom', { name: f.name }))
          continue
        }
        const title = f.name.replace(/\.[^.]+$/, '') || 'Untitled'
        // Straight from the original file — no data-URL round-trip to re-encode
        await uploadArtwork({ ownerId: user.id, file: f, title })
      }
      await refreshCloud()
    } catch (e) {
      alert(t('me.uploadFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      setUploading(false)
    }
  }

  async function removeWork(art: ArtworkData) {
    let msg = `Remove “${art.title}” from your library?`
    try {
      if ((await artworkPlacementCount(art.id)) > 0) {
        msg = `“${art.title}” is hanging in your public gallery. Removing it also takes it off the wall. Continue?`
      }
    } catch {
      /* placements unreadable — fall back to the generic confirm */
    }
    if (!confirm(msg)) return
    try {
      await deleteArtwork(user.id, art.id)
      await refreshCloud()
    } catch (e) {
      alert(t('me.workRemoveFailed', { msg: String(e instanceof Error ? e.message : e) }))
    }
  }

  // The work's plate text (title/caption/price/link/size/medium) autosaves after a
  // short pause — same "type and it saves" model as the exhibition title/statement,
  // so there's no Save button. The payload is captured at call time, so switching
  // works mid-debounce still commits the edit to the work it was made on.
  function editWork(next: Partial<{
    title: string; caption: string; purchaseUrl: string; price: string; width: string; height: string; medium: string
  }>) {
    if (next.title !== undefined) setTitleInput(next.title)
    if (next.caption !== undefined) setCaptionInput(next.caption)
    if (next.purchaseUrl !== undefined) setPurchaseUrlInput(next.purchaseUrl)
    if (next.price !== undefined) setPriceInput(next.price)
    if (next.width !== undefined) setWidthInput(next.width)
    if (next.height !== undefined) setHeightInput(next.height)
    if (next.medium !== undefined) setMediumInput(next.medium)
    const id = selected?.id
    if (!id) return
    const w = parseFloat(next.width ?? widthInput)
    const h = parseFloat(next.height ?? heightInput)
    const payload = {
      title: next.title ?? titleInput,
      description: next.caption ?? captionInput,
      purchaseUrl: next.purchaseUrl ?? purchaseUrlInput,
      price: next.price ?? priceInput,
      widthCm: Number.isFinite(w) && w > 0 ? w : null,
      heightCm: Number.isFinite(h) && h > 0 ? h : null,
      medium: next.medium ?? mediumInput,
    }
    setWorkState('saving')
    if (workTimer.current) clearTimeout(workTimer.current)
    workTimer.current = setTimeout(() => {
      updateArtworkDetails(id, payload)
        .then(async () => {
          await refreshCloud()
          setWorkState('idle')
          toast()
        })
        .catch((e) => {
          alert(t('me.workSaveFailed', { msg: String(e instanceof Error ? e.message : e) }))
          setWorkState('idle')
        })
    }, 900)
  }
  useEffect(() => () => {
    if (workTimer.current) clearTimeout(workTimer.current)
  }, [])

  // The shared work editor: opens from the works row and from the placement map
  // (DECISIONS 2026-07-30 — hanging and describing a work used to live in different
  // views). Always inline, on every width: the works stage keeps one work selected
  // at all times, so a half-height modal would cover the row it belongs to
  // (ユーザー指示 2026-07-30).
  const workSheet = selected ? (
    <div className="me-worksheet">
      <div className="me-worksheet-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img crossOrigin="anonymous" className="me-sheet-thumb" src={selected.poster ?? selected.thumb ?? selected.src} alt="" />
        <span className="me-sheet-title">{selected.title || t('common.untitled')}</span>
        {/* Delete moved to the × on each thumbnail (ユーザー指示 2026-07-30); the head
            keeps only the autosave state. */}
        {workState !== 'idle' && (
          <span className="hako-save-state">{workState === 'saving' ? t('common.saving') : t('common.saved')}</span>
        )}
      </div>
      {/* The name plate's text: title + caption, straight onto the plate above. */}
      <div className="wd-group wd-group--flush">
        <div className="wd-title"><span>{t('me.titleAndCaption')}</span></div>
        <label className="me-field" style={{ margin: '0.45rem 0' }}>
          <span>{t('me.workTitle')}</span>
          <input
            type="text"
            maxLength={TITLE_MAX}
            value={titleInput}
            onChange={(e) => editWork({ title: e.target.value })}
          />
        </label>
        <label className="me-field" style={{ margin: '0.45rem 0' }}>
          <FieldLabel hint={t('me.captionHint')}>{t('me.caption')}</FieldLabel>
          <textarea
            rows={2}
            maxLength={140}
            placeholder={t('me.captionPlaceholder')}
            value={captionInput}
            onChange={(e) => editWork({ caption: e.target.value })}
          />
        </label>
        <label className="me-field" style={{ margin: '0.45rem 0' }}>
          <FieldLabel hint={t('me.priceHint')}>{t('me.price')}</FieldLabel>
          <input
            type="text"
            placeholder={t('me.pricePlaceholder')}
            value={priceInput}
            onChange={(e) => editWork({ price: e.target.value })}
          />
        </label>
        <label className="me-field" style={{ margin: '0.45rem 0' }}>
          <FieldLabel hint={t('me.purchaseLinkHint')}>{t('me.purchaseLink')}</FieldLabel>
          <input
            type="text"
            inputMode="url"
            placeholder={t('me.purchaseLinkPlaceholder')}
            value={purchaseUrlInput}
            onChange={(e) => editWork({ purchaseUrl: e.target.value })}
          />
        </label>
        <div className="wd-row" style={{ margin: '0.45rem 0' }}>
          <span className="wd-label">{t('me.size')}</span>
          <div className="design-controls" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* Pick a standard size (号 / A / B), or "Custom" to type cm. The W×H
                fields only appear in custom mode; a preset shows just the ⇄ swap. */}
            <select
              className="ent-select"
              value={sizeCustom ? 'custom' : (matchPreset(parseFloat(widthInput), parseFloat(heightInput)) ?? 'custom')}
              onChange={(e) => {
                const p = presetByLabel(e.target.value)
                if (p) {
                  editWork({ width: String(p.w), height: String(p.h) })
                  setSizeCustom(false)
                } else {
                  setSizeCustom(true) // "{t('me.sizeCustom')}" — reveal the cm fields
                }
              }}
            >
              <option value="custom">{t('me.sizeCustom')}</option>
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
                    onChange={(e) => editWork({ width: e.target.value })}
                  />
                  <span aria-hidden="true" style={{ color: 'var(--muted)' }}>×</span>
                  <input
                    type="number"
                    min={1}
                    inputMode="decimal"
                    placeholder="H"
                    className="size-num"
                    value={heightInput}
                    onChange={(e) => editWork({ height: e.target.value })}
                  />
                  <span aria-hidden="true" style={{ color: 'var(--muted)' }}>cm</span>
                </>
              )}
              <button
                type="button"
                className="btn-line"
                title={t('me.swapSize')}
                style={{ padding: '0.35em 0.6em' }}
                onClick={() => editWork({ width: heightInput, height: widthInput })}
              >
                ⇄
              </button>
            </div>
          </div>
        </div>
        {/* Cover-fit crops the image when the chosen size's aspect differs from the
            image's — warn so the artist knows part of the picture is cut off
            (ユーザー指示 2026-07-30). The ⇄ swap can flip the ratio to fix it. */}
        {(() => {
          const w = parseFloat(widthInput)
          const h = parseFloat(heightInput)
          if (!(w > 0 && h > 0)) return null
          const imgA = selected.ratio[0] / selected.ratio[1]
          const sizeA = w / h
          const crop = 1 - Math.min(imgA, sizeA) / Math.max(imgA, sizeA)
          if (crop <= 0.01) return null
          return <p className="me-note me-note--warn">{t('me.cropWarn', { pct: Math.round(crop * 100) })}</p>
        })()}
        <label className="me-field" style={{ margin: '0.45rem 0' }}>
          <FieldLabel hint={t('me.mediumHint')}>{t('me.medium')}</FieldLabel>
          <input
            type="text"
            placeholder={t('me.mediumPlaceholder')}
            value={mediumInput}
            onChange={(e) => editWork({ medium: e.target.value })}
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
        lightKey={lightKey}
        onLight={(k) => {
          const next = { ...lightOverrides }
          if (k) next[selected.id] = k
          else delete next[selected.id]
          updateSettings({ lightOverrides: next })
          toast()
        }}
        onFrame={(k) => {
          updateSettings({ frameOverrides: setOverride(frameOverrides, selected.id, k, row.frame_default) })
          toast()
        }}
        onMat={(k) => {
          updateSettings({ matOverrides: setOverride(matOverrides, selected.id, k, row.mat_default) })
          toast()
        }}
        onHanging={(k) => {
          updateSettings({ hangingOverrides: setOverride(hangingOverrides, selected.id, k, row.hanging_default) })
          toast()
        }}
        onCaption={(k) => {
          updateSettings({ captionOverrides: setOverride(captionOverrides, selected.id, k, row.caption_default) })
          toast()
        }}
      />
    </div>
  ) : null

  return (
    <>
    {/* The stage bar is the only navigation (the header card and the top tabs are
        gone — ユーザー指示 2026-07-30). Profile leads (who you are), then the publish
        flow; the guestbook lives INSIDE the publish stage. (Per-stage "done" check
        marks were dropped — ユーザー指示 2026-07-31.) */}
    <nav className="me-stages" aria-label={t('me.navSections')}>
      {(
        [
          ['profile', t('me.tabProfile'), null],
          ['works', t('me.stageWorks'), cloudArtworks.length || null],
          ['room', t('me.navRoom'), null],
          ['placement', t('me.placement'), null],
          ['publish', t('me.stagePublish'), null],
        ] as const
      ).map(([key, label, count]) => (
        <button
          key={key}
          type="button"
          className={`me-stage${stage === key ? ' active' : ''}`}
          aria-current={stage === key ? 'page' : undefined}
          onClick={() => setStage(key)}
        >
          {label}
          {count != null && <span className="me-stage-count">{count}</span>}
        </button>
      ))}
    </nav>
    {/* One next step at a time toward publishing — not shown on the housekeeping stages */}
    {(() => {
      if (stage === 'profile') return null
      const hint = cloudArtworks.length === 0
        ? { key: 'me.hintAddWork', to: 'works' as const }
        : !username
          ? { key: 'me.hintUsername', to: 'publish' as const }
          : !row.is_public
            ? { key: 'me.hintPublish', to: 'publish' as const }
            : null
      if (!hint || stage === hint.to) return null
      return (
        <button type="button" className="me-stage-hint" onClick={() => setStage(hint.to)}>
          → {t(hint.key)}
        </button>
      )
    })()}

    {/* The stage’s working surface. Profile brings its own card; the flow stages
        share the subcard (the guestbook now lives inside the publish stage). */}
    <div className="me-gallery-body">
      {stage === 'profile' ? (
        <ProfileCard />
      ) : (
      <div className="me-card me-subcard">
      {stage === 'room' ? (
        /* The room's editing surface: sticky 3D preview on the left, its design on the right */
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
          emptyNote={t('me.emptyRoomNote')}
          mode="room"
        />

        <div className="we-right">
          {/* Section 1 — the room's look: theme + layout. The 3D preview on the left
              recolours live as you switch theme. (Design Tools hidden for now.) */}
          <div className="wd-group wd-group--flush">
            <div className="wd-title"><span>{t('me.themeAndLayout')}</span></div>
            {/* Templates are a starting point, not a setting: they live in the create
                card (and in the 3D panel) only. Once the room exists, theme and layout
                are the two chips below — a template row here just offered a second,
                coarser way to change the same two things (ユーザー指示 2026-07-30). */}
            <div className="wd-row">
              <span className="wd-label">{t('me.theme')}</span>
              <div className="chips">
                {unlockedFirst(Object.entries(THEMES), ([key]) => isThemeUnlocked(key, entitlements)).map(([key, def]) => {
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
              <span className="wd-label">{t('me.layout')}</span>
              <div className="chips">
                {unlockedFirst(Object.entries(LAYOUTS), ([key]) => isLayoutUnlocked(key, entitlements)).map(([key, def]) => {
                  const unlocked = isLayoutUnlocked(key, entitlements)
                  return (
                    <button
                      key={key}
                      className={`chip chip-visual${key === row.layout ? ' active' : ''}${unlocked ? '' : ' locked'}`}
                      disabled={busy}
                      onClick={() => {
                        if (!unlocked) { setPurchaseItem({ kind: 'layout', key, label: t(`presets.layout.${key}`) }); return }
                        void setSpace({ layout: key })
                      }}
                    >
                      <LayoutPlan layoutKey={key} className="chip-plan" />
                      {t(`presets.layout.${key}`)}
                      {!unlocked && <span className="chip-price-tag chip-lock-only" aria-hidden="true"><LockIcon /></span>}
                    </button>
                  )
                })}
                {/* Not released yet, so no chip offers it to a new room (lib/presets →
                    CUSTOM_LAYOUT_RELEASED). A room already ON 'custom' keeps the chip and
                    its size sliders — it renders as before and can still come back to its
                    own shape. Once released, the chip goes through the same lock/purchase
                    path as the presets: free access was the bug, not the feature.
                    layout_params survive preset switches (saveGallerySpace preserves them). */}
                {(CUSTOM_LAYOUT_RELEASED || row.layout === 'custom') && (() => {
                  const unlocked = row.layout === 'custom' || isLayoutUnlocked('custom', entitlements)
                  return (
                    <button
                      className={`chip chip-visual${row.layout === 'custom' ? ' active' : ''}${unlocked ? '' : ' locked'}`}
                      disabled={busy}
                      onClick={() => {
                        if (!unlocked) { setPurchaseItem({ kind: 'layout', key: 'custom', label: t('me.custom') }); return }
                        void setSpace({ layout: 'custom' })
                      }}
                    >
                      <LayoutPlan layoutKey="custom" params={row.layout_params} className="chip-plan" />
                      {t('me.custom')}
                      {!unlocked && <span className="chip-price-tag chip-lock-only" aria-hidden="true"><LockIcon /></span>}
                    </button>
                  )
                })()}
              </div>
            </div>
            <div className="wd-row">
              <span className="wd-label">{t('me.lighting')}</span>
              <div className="chips">
                {([
                  ['ceiling', 'me.lightCeiling'],
                  ['overhead', 'me.lightOverhead'],
                ] as const).map(([key, labelKey]) => (
                  <button
                    key={key}
                    className={`chip${(design.lightMode ?? 'ceiling') === key ? ' active' : ''}`}
                    disabled={busy}
                    onClick={() => editDesign({ lightMode: key })}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>
            {row.layout === 'custom' && (
              <div className="wd-row wd-row-block">
                <span className="wd-label">{t('me.customSize')}</span>
                <div className="wd-block-body custom-size">
                  <label className="slider-row">
                    <span>{t('common.widthM', { n: Math.round(custom.hw * 2) })}</span>
                    <input
                      type="range" min={8} max={18} step={0.5} value={custom.hw} disabled={busy}
                      onChange={(e) => editCustom({ hw: Number(e.target.value) })}
                    />
                  </label>
                  <label className="slider-row">
                    <span>{t('common.depthM', { n: Math.round(custom.hd * 2) })}</span>
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
                    {t('me.centreWall')}
                  </label>
                </div>
              </div>
            )}
            <div className="wd-row wd-row-block">
              <span className="wd-label me-field-label">
                {t('me.ambience')}
                <span
                  className="field-hint"
                  tabIndex={0}
                  role="note"
                  aria-label={t('me.ambienceHint', { max: Math.floor(GALLERY_BGM_MAX_BYTES / 1024 / 1024) })}
                >
                  <InfoIcon />
                  <span className="field-hint-pop" role="tooltip">
                    {t('me.ambienceHint', { max: Math.floor(GALLERY_BGM_MAX_BYTES / 1024 / 1024) })}
                  </span>
                </span>
              </span>
              <div className="wd-block-body">
                {/* .hako-actions はカードの本文の下に置く前提で margin-top: 1.2rem を持っており、
                    そのまま block-body に入れると見出しとボタンの間が29px空いた（他の行は約10px）。
                    この行では行間は .wd-block-body の gap が決めるので、上マージンは殺す。 */}
                <div className="hako-actions" style={{ alignItems: 'center', marginTop: 0 }}>
                  <label className="btn-line file-btn" aria-disabled={bgmBusy} style={{ marginTop: 0 }}>
                    {bgmBusy ? t('me.uploading') : bgmUrl ? t('me.replaceTrack') : t('me.uploadTrack')}
                    <input
                      type="file"
                      accept="audio/*"
                      hidden
                      disabled={bgmBusy}
                      onChange={(e) => void onBgmFile(e.target.files?.[0])}
                    />
                  </label>
                  {bgmUrl && (
                    <button className="btn-line" disabled={bgmBusy} onClick={() => void removeBgm()}>
                      {t('me.remove')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {DESIGN_TOOLS_VISIBLE && (
          <>
          {/* Design Tools (§11.5/§11.8) — a buy-once capability layered on top of the
              theme: recolour walls/floor, tune the light mood, add a small logo mark.
              Hidden for now via DESIGN_TOOLS_VISIBLE. */}
          <div className="wd-group">
            <div className="wd-title"><span>{t('me.designTools')}</span></div>
            {/* Design Tools is free for everyone now (docs/DECISIONS 2026-07-24) */}
            <>
                <div className="wd-row">
                  <span className="wd-label">{t('me.wallColour')}</span>
                  <div className="design-controls">
                    <input
                      type="color"
                      value={design.wall ?? hex((THEMES[row.theme] ?? THEMES.chic).wall)}
                      onChange={(e) => editDesign({ wall: e.target.value })}
                    />
                    {design.wall && (
                      <button className="btn-line" onClick={() => editDesign({ wall: null })}>{t('me.reset')}</button>
                    )}
                  </div>
                </div>
                <div className="wd-row">
                  <span className="wd-label">{t('me.floorColour')}</span>
                  <div className="design-controls">
                    <input
                      type="color"
                      value={design.floor ?? hex((THEMES[row.theme] ?? THEMES.chic).floorTint)}
                      onChange={(e) => editDesign({ floor: e.target.value })}
                    />
                    {design.floor && (
                      <button className="btn-line" onClick={() => editDesign({ floor: null })}>{t('me.reset')}</button>
                    )}
                  </div>
                </div>
                <div className="wd-row">
                  <span className="wd-label">{t('me.lightColour')}</span>
                  <div className="design-controls">
                    <input
                      type="color"
                      value={design.lightColor ?? hex((THEMES[row.theme] ?? THEMES.chic).spotColor)}
                      onChange={(e) => editDesign({ lightColor: e.target.value })}
                    />
                    {design.lightColor && (
                      <button className="btn-line" onClick={() => editDesign({ lightColor: null })}>{t('me.reset')}</button>
                    )}
                  </div>
                </div>
                <div className="wd-row">
                  <span className="wd-label">{t('me.lightMood')}</span>
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
                      <button className="btn-line" onClick={() => editDesign({ lightIntensity: null })}>{t('me.reset')}</button>
                    )}
                  </div>
                </div>
                <div className="wd-row">
                  <span className="wd-label">{t('me.logo')}</span>
                  <div className="design-controls">
                    {design.logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img crossOrigin="anonymous" src={design.logoUrl} alt="" className="design-logo-preview" />
                    )}
                    <label className="btn-line file-btn" aria-disabled={logoUploading} style={{ marginTop: 0 }}>
                      {logoUploading ? t('me.uploading') : design.logoUrl ? t('me.changeLogo') : t('me.uploadLogo')}
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
                      <button className="btn-line" onClick={() => editDesign({ logoUrl: null })}>{t('me.remove')}</button>
                    )}
                  </div>
                </div>
                <p className="me-note" style={{ marginTop: '0.3rem' }}>
                  {t('me.designToolsNote')}
                </p>
              </>
          </div>
          </>
          )}
        </div>
      </div>
      ) : stage === 'works' ? (
        /* The works library: grid + the shared editor sheet */
        <div className="works-detail">
          <GalleryPreview
            art={selected ? previewArt : roomArt}
            src={selected ? previewSrc : roomSrc}
            index={selected ? selectedIndex : Math.max(0, cloudArtworks.indexOf(roomArt))}
            themeKey={row.theme}
            frameKey={selected ? frame : row.frame_default}
            matKey={selected ? mat : row.mat_default}
            hangingKey={selected ? hanging : row.hanging_default}
            captionKey={selected ? captionKey : row.caption_default}
            designOverrides={selected ? selectedDesign : design}
            emptyNote={t('me.emptyRoomNote')}
            mode={selected ? 'work' : 'room'}
          />
          <div className="we-right">
            <div className="me-works-head">
              <span className="me-works-count">{t('me.navWorksCount', { count: cloudArtworks.length, cap: row.work_cap })}</span>
              <button
                type="button"
                className="btn-line"
                disabled={row.work_cap >= MAX_WORKS_PER_ROOM}
                title={row.work_cap >= MAX_WORKS_PER_ROOM ? t('me.roomFullHint') : t('me.addSlotsHint', { price: PRICE_SLOT })}
                onClick={() => setPurchaseItem({ kind: 'capacity', key: 'capacity', label: t('me.addWorkSlots') })}
              >
                {row.work_cap >= MAX_WORKS_PER_ROOM ? t('me.roomFull') : t('me.addSlots')}
              </button>
            </div>
            {/* One row, scrolled sideways when it outgrows the width. "Add" sits at
                the HEAD of the row: at the tail it ends up past the right edge once
                there are a few works — the same trap the old rail fell into
                (ユーザー指摘 2026-07-28). */}
            <div className="me-works-row">
              {cloudArtworks.length < row.work_cap && (
                <label className={`me-work-tile me-add-tile${uploading ? ' busy' : ''}`} aria-disabled={uploading}>
                  <span className="me-add-tile-plus" aria-hidden="true">{uploading ? '…' : '+'}</span>
                  <small>{uploading ? t('me.uploading') : cloudArtworks.length === 0 ? t('me.addFirstWork') : t('me.addWork')}</small>
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
              {cloudArtworks.map((art) => (
                /* The delete × is a SIBLING of the tile button, not nested (a button
                   inside a button is invalid) — hence the wrapper (ユーザー指示
                   2026-07-30, delete moved here from the editor sheet). */
                <div key={art.id} className="me-work-tile-wrap">
                  <button
                    type="button"
                    className={`me-work-tile${selectedId === art.id ? ' active' : ''}`}
                    title={art.title}
                    aria-current={selectedId === art.id ? 'true' : undefined}
                    onClick={() => setSelectedId(art.id)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img crossOrigin="anonymous" src={art.poster ?? art.thumb ?? art.src} alt={art.title} loading="lazy" />
                    {art.kind === 'video' && <span className="me-work-tile-video" aria-hidden="true"><VideoIcon /></span>}
                    {/* Points at the editor below, so "this is the one you're editing"
                        reads without a label the 64px tile has no room for. */}
                    {selectedId === art.id && <span className="me-work-tile-mark" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="me-work-tile-del"
                    aria-label={t('me.workRemove')}
                    title={t('me.workRemove')}
                    onClick={() => void removeWork(art)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {workSheet}
          </div>
        </div>
      ) : stage === 'placement' ? (
        /* Placement is a top-down room map (ユーザー指示 2026-07-31): drag a work from the
           tray onto a wall slot to hang it, drag a hung work onto another to swap them.
           editPlacement persists the arrangement + rebuilds the public room. */
        <div className="placement-stage">
          {cloudArtworks.length > 0 ? (
            <>
              <div className="placement-head">
                <h3 className="placement-title">{t('me.placement')}</h3>
                <p className="me-note" style={{ marginTop: '0.3rem' }}>{t('me.placementDragHint')}</p>
              </div>
              <PlacementEditor
                layoutKey={row.layout}
                layoutParams={normalizeLayoutParams(row.layout_params)}
                workCap={row.work_cap}
                works={cloudArtworks}
                arrangement={placement}
                onChange={editPlacement}
                disabled={busy}
              />
            </>
          ) : (
            <>
              <p className="me-note" style={{ marginTop: 0 }}>{t('me.hintAddWork')}</p>
              <button type="button" className="btn-line" onClick={() => setStage('works')}>
                {t('me.addFirstWork')}
              </button>
            </>
          )}
        </div>
      ) : (
        /* Publish: everything about going public in one place — the URL name gate,
           the statement, the share cover, the switch, and the numbers */
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
            emptyNote={t('me.emptyRoomNote')}
            mode="room"
          />
          <div className="we-right">
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
                {row.is_public && publicUrl && (
                  <button
                    className="hako-url-copy"
                    title={copied ? t('me.copied') : t('me.copyUrl')}
                    aria-label={copied ? t('me.copied') : t('me.copyUrl')}
                    onClick={() => {
                      void navigator.clipboard.writeText(publicUrl).then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1600)
                      })
                    }}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                )}
                <label
                  className="switch"
                  title={
                    row.is_public
                      ? t('me.openHint')
                      : cloudArtworks.length
                        ? t('me.privateHint')
                        : t('me.needWorkHint')
                  }
                >
                  <input type="checkbox" checked={row.is_public} disabled={busy} onChange={() => void togglePublic()} />
                  <span className="knob" aria-hidden="true" />
                </label>
                <span className={`hako-state${row.is_public ? ' open' : ''}`}>{row.is_public ? t('me.open') : t('me.private')}</span>
              </div>
            ) : (
              /* No username means no public URL, so there is nothing for the switch to
                 switch — the reason and the fix sit exactly where the toggle would be. */
              <div className="hako-url-row hako-url-locked">
                {/* i18n-ok: URLの見本 */}
                <span className="hako-url off">xibit360.art/@…</span>
                <p className="hako-locked-why">{t('me.usernameGate')}</p>
                <div className="field-row">
                  <input
                    type="text"
                    aria-label={t('me.username')}
                    placeholder={t('me.usernamePlaceholder')}
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                  />
                  <button
                    className="btn-line"
                    disabled={busy || !usernameInput.trim()}
                    onClick={() => void saveUsernameInline()}
                  >
                    {t('me.usernameSet')}
                  </button>
                </div>
              </div>
            )}
            {/* Actions for the finished room: walk it in 3D (always — the room can be
                arranged before it's public), plus embed + catalog once it's live
                (ユーザー指示 2026-07-30 — "部屋を歩く" moved here from the header). */}
            <div className="hako-url-actions">
              <LocaleLink className="btn-line" href="/demo">{t('me.navWalk')}</LocaleLink>
              {row.is_public && embedCode && (
                <button className="btn-line" onClick={() => setShowEmbed((v) => !v)}>
                  {showEmbed ? t('me.embedHide') : t('me.embed')}
                </button>
              )}
              {row.is_public && username && (
                <a className="btn-line" href={`/@${username}/${row.slug}/catalog`} target="_blank" rel="noreferrer">
                  {t('me.catalog')}
                </a>
              )}
            </div>
            {/* The exhibition's own words — the title and the statement, edited
                together where the room goes public (ユーザー指示 2026-07-30). */}
            <div className="wd-group">
              <div className="wd-title">
                <span>{t('me.exhibitionTitle')}</span>
                {detailsState !== 'idle' && (
                  <span className="hako-save-state">{detailsState === 'saving' ? t('common.saving') : t('common.saved')}</span>
                )}
              </div>
              <input
                className="hako-title-input"
                type="text"
                maxLength={TITLE_MAX}
                value={nameInput}
                placeholder={t('me.untitledPlaceholder')}
                aria-label={t('me.exhibitionTitle')}
                onChange={(e) => editDetails({ title: e.target.value })}
              />
              <textarea
                className="hako-statement-input"
                rows={2}
                maxLength={200}
                placeholder={t('me.statementBoardPlaceholder')}
                aria-label={t('me.exhibitionStatement')}
                value={statementInput}
                onChange={(e) => editDetails({ statement: e.target.value })}
              />
            </div>
            {cloudArtworks.length > 0 && (
              <div className="wd-group">
                <div className="wd-title"><span>{t('me.coverPick')}</span></div>
                <div className="me-cover-row">
                  {cloudArtworks.map((art) => (
                    <button
                      type="button"
                      key={art.id}
                      className={`me-cover-thumb${row.cover_artwork_id === art.id ? ' active' : ''}`}
                      title={row.cover_artwork_id === art.id ? t('me.shareCover') : t('me.setAsCover')}
                      disabled={busy}
                      onClick={() => void toggleCover(art)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img crossOrigin="anonymous" src={art.poster ?? art.thumb ?? art.src} alt={art.title} loading="lazy" />
                      {row.cover_artwork_id === art.id && <span className="me-cover-star" aria-hidden="true">★</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* How the exhibition is doing, at a glance */}
            <div className="stat-row">
              <div className="stat"><b>{cloudArtworks.length}</b><span>{t('me.statWorks')}</span></div>
              <div className="stat"><b>{stats ? stats.visits : '–'}</b><span>{t('me.statVisits')}</span></div>
              <div className="stat"><b>{stats ? stats.likes : '–'}</b><span>{t('me.statLikes')}</span></div>
              <div className="stat"><b>{stats ? stats.guestbook : '–'}</b><span>{t('me.statGuestNotes')}</span></div>
            </div>
            <p className="hako-meta">{row.updated_at ? t('me.updatedAt', { date: fmtDate(row.updated_at) }) : ''}</p>
            {row.is_public && embedCode && showEmbed && (
              <div
                className="me-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-label={t('me.embedCode')}
                onClick={() => setShowEmbed(false)}
              >
                <div className="me-modal embed-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="me-modal-head">
                    <h3>{t('me.embedTitle')}</h3>
                    <button className="me-modal-close" aria-label={t('common.close')} onClick={() => setShowEmbed(false)}>✕</button>
                  </div>
                  <p className="me-note" style={{ marginTop: 0 }}>
                    {t('me.embedBody')}
                  </p>
                  <code className="embed-code">{embedCode}</code>
                  <button
                    className="wd-save-cta wd-save-compact"
                    onClick={() => {
                      void navigator.clipboard.writeText(embedCode).then(() => {
                        setEmbedCopied(true)
                        setTimeout(() => setEmbedCopied(false), 1600)
                      })
                    }}
                  >
                    {embedCopied ? `${t('me.copied')} ✓` : t('me.copyEmbed')}
                  </button>
                </div>
              </div>
            )}
            {/* Guestbook moderation lives here — it's part of going public (visitors
                sign it), so it belongs with the publish controls, not its own stage
                (ユーザー指示 2026-07-30). */}
            <GuestbookCard galleryId={row.id} enabled={row.guestbook_enabled !== false} />
            {/* Quiet row for rare / destructive housekeeping — not a peer of the rest */}
            <div className="hako-secondary">
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (!confirm(t('me.deleteGalleryConfirm', { name: isPlaceholderTitle(row.title) ? t('me.myGallery') : row.title }))) return
                  void run(t('me.deleteGallery'), () => deleteGallery(row.id))
                }}
              >
                {t('me.deleteGallery')}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      )}
    </div>

    {purchaseItem && (
        <PurchaseModal
          itemLabel={purchaseItem.label}
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
            ) : undefined
          }
          item={
            purchaseItem.kind === 'capacity'
              ? undefined
              : { kind: purchaseItem.kind, itemKey: purchaseItem.key }
          }
          quantity={
            purchaseItem.kind === 'capacity'
              ? {
                  unitCents: PRICE_PER_SLOT_CENTS,
                  max: MAX_WORKS_PER_ROOM - row.work_cap,
                  initial: purchaseItem.qty,
                }
              : undefined
          }
          intent={{
            kind: purchaseItem.kind,
            itemKey: purchaseItem.kind === 'capacity' ? '' : purchaseItem.key,
            galleryId: purchaseItem.kind === 'capacity' ? row.id : undefined,
          }}
          onClose={() => setPurchaseItem(null)}
        />
      )}
    </>
  )
}

// Guestbook moderation: read what visitors wrote, delete spam
function GuestbookCard({ galleryId, enabled }: { galleryId: string; enabled: boolean }) {
  const t = useT()
  const [entries, setEntries] = useState<GuestbookEntry[] | null>(null)
  // Visitors could always write, and the artist could only delete afterwards.
  const [open, setOpen] = useState(enabled)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    listGuestbook(galleryId, 30)
      .then(setEntries)
      .catch(() => setEntries(null))
  }, [galleryId])

  useEffect(() => {
    load()
  }, [load])

  async function toggle() {
    const next = !open
    setBusy(true)
    setOpen(next) // optimistic — the switch should never feel laggy
    try {
      await saveGuestbookEnabled(galleryId, next)
    } catch (e) {
      setOpen(!next)
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (entries === null) return null // migration 0008 not applied (or fetch failed) — hide quietly
  // Rendered inside the publish stage now — a bordered section (no me-card wrapper,
  // which would nest a card inside the stage's card).
  return (
    <div className="wd-group gb-group">
      <div className="wd-title"><span>{t('me.tabGuestbook')}</span></div>
      <div className="gb-toggle-row">
        <label className="switch" title={open ? t('me.guestbookOpenHint') : t('me.guestbookClosedHint')}>
          <input type="checkbox" checked={open} disabled={busy} onChange={() => void toggle()} />
          <span className="knob" aria-hidden="true" />
        </label>
        <div>
          <div className="gb-toggle-label">{open ? t('me.guestbookOpenLabel') : t('me.guestbookClosedLabel')}</div>
          <p className="me-note" style={{ margin: 0 }}>
            {open
              ? t('me.guestbookOpenNote')
              : t('me.guestbookClosedNote')}
          </p>
        </div>
      </div>
      {entries.length === 0 && (
        <p className="me-note">{t('me.guestbookNone')}</p>
      )}
      <ul className="gb-list">
        {entries.map((e) => (
          <li key={e.id}>
            <div className="gb-meta">
              <b>{e.name || t('guestbook.anonymous')}</b> · {fmtDate(e.created_at)}
              <button
                aria-label={t('me.deleteEntry')}
                onClick={() => {
                  if (!confirm(t('me.deleteEntryConfirm'))) return
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
  const t = useT()
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
      alert(t('me.accountEmailFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      setBusy(false)
    }
  }

  async function removeAccount() {
    if (!confirm(t('me.accountDeleteConfirm1'))) return
    if (!confirm(t('me.accountDeleteConfirm2'))) return
    setBusy(true)
    try {
      await deleteMyAccount(user.id)
      location.href = '/'
    } catch (e) {
      console.error('account deletion failed (is 0007_delete_account.sql applied?):', e)
      alert(t('me.accountDeleteFailed', { msg: String(e instanceof Error ? e.message : e) }))
      setBusy(false)
    }
  }

  return (
    <div className="me-card">
      <label className="me-field">
        <span>{t('me.accountEmailCurrent', { email: user.email ?? t('me.accountEmailNone') })}</span>
        <div className="field-row" style={{ marginTop: 0 }}>
          <input
            type="email"
            placeholder={t('me.accountEmailPlaceholder')}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button className="btn-line" disabled={busy || !newEmail.trim()} onClick={() => void changeEmail()}>
            {t('me.accountChange')}
          </button>
        </div>
      </label>
      {emailSent && (
        <p className="me-note">
          {t('me.accountEmailSent')}
        </p>
      )}
      <div className="hako-actions">
        <Link className="btn-line" href="/reset">{t('me.accountPassword')}</Link>
        <button className="btn-line hako-danger" disabled={busy} onClick={() => void removeAccount()}>
          {t('me.accountDelete')}
        </button>
      </div>
    </div>
  )
}

function ProfileCard() {
  const t = useT()
  const user = useGallery((s) => s.user)!
  const username = useGallery((s) => s.profileUsername)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const toast = useToast()
  const [nameInput, setNameInput] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // Known-platform links keyed by id, plus free-form "other" links
  const [snsLinks, setSnsLinks] = useState<Record<string, string>>({})
  const [snsCustom, setSnsCustom] = useState<CustomLink[]>([])
  const [busy, setBusy] = useState(false)
  // Profile text (display name / bio / SNS) autosaves like everything else.
  const [profileState, setProfileState] = useState<'idle' | 'saving'>('idle')
  const profileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    getProfile(user.id)
      .then((p) => {
        if (!alive) return
        setDisplayName(p.displayName)
        setBio(p.bio)
        setAvatarUrl(p.avatarUrl)
        setSnsLinks(p.sns.links)
        setSnsCustom(p.sns.custom)
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
      toast()
    } catch (e) {
      alert(t('me.avatarUploadFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      setBusy(false)
    }
  }

  async function saveUsername() {
    const name = nameInput.trim().toLowerCase()
    if (!USERNAME_RE.test(name)) {
      alert(t('me.usernameRules'))
      return
    }
    setBusy(true)
    try {
      await setUsername(user.id, name)
      await refreshCloud()
      setNameInput('')
      toast()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Display name / bio / SNS autosave after a short pause (payload captured at call
  // time, like the gallery's editWork). Username + avatar stay explicit above.
  function editProfile(next: Partial<{
    displayName: string; bio: string; links: Record<string, string>; custom: CustomLink[]
  }>) {
    if (next.displayName !== undefined) setDisplayName(next.displayName)
    if (next.bio !== undefined) setBio(next.bio)
    if (next.links !== undefined) setSnsLinks(next.links)
    if (next.custom !== undefined) setSnsCustom(next.custom)
    const payload = {
      displayName: next.displayName ?? displayName,
      bio: next.bio ?? bio,
      sns: { links: next.links ?? snsLinks, custom: next.custom ?? snsCustom },
    }
    setProfileState('saving')
    if (profileTimer.current) clearTimeout(profileTimer.current)
    profileTimer.current = setTimeout(() => {
      saveProfile(user.id, payload)
        .then(async () => {
          await refreshCloud()
          setProfileState('idle')
          toast()
        })
        .catch((e) => {
          alert(t('me.profileSaveFailed', { msg: String(e instanceof Error ? e.message : e) }))
          setProfileState('idle')
        })
    }, 900)
  }
  useEffect(() => () => {
    if (profileTimer.current) clearTimeout(profileTimer.current)
  }, [])

  return (
    <>
    <div className="me-section-head">
      <h2>{t('me.tabProfile')}</h2>
      {profileState === 'saving' && <span className="hako-save-state">saving…</span>}
    </div>
    <div className="me-card">
      <div className="avatar-row">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img crossOrigin="anonymous" className="avatar-img" src={avatarUrl} alt={t('me.profileAvatar')} />
        ) : (
          <div className="avatar-img avatar-empty">{(displayName || 'A').slice(0, 1).toUpperCase()}</div>
        )}
        <label className="btn-line file-btn" aria-disabled={busy} style={{ marginTop: 0 }}>
          {busy ? t('me.uploading') : avatarUrl ? t('me.changeAvatar') : t('me.uploadAvatar')}
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
        <span>{t('me.usernameLabel', { name: username ?? t('me.usernamePlaceholder') })}</span>
        <div className="field-row" style={{ marginTop: 0 }}>
          <input
            type="text"
            placeholder={username ?? t('me.usernamePlaceholder')}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <button className="btn-line" disabled={busy || !nameInput.trim()} onClick={() => void saveUsername()}>
            {username ? t('common.change') : t('common.set')}
          </button>
        </div>
      </label>
      <label className="me-field">
        <span>{t('me.profileName')}</span>
        <input type="text" value={displayName} onChange={(e) => editProfile({ displayName: e.target.value })} />
      </label>
      <label className="me-field">
        <span>{t('me.profileBio')}</span>
        <textarea rows={3} value={bio} onChange={(e) => editProfile({ bio: e.target.value })} />
      </label>
      <p className="me-field-group-label">
        {t('me.profileSnsNote')}
      </p>
      {/* One row per known platform with its official brand mark; leave any blank
          to hide it. "Other" links are added freely below (ユーザー指示 2026-07-30). */}
      <div className="sns-fields">
        {SNS_PLATFORMS.map((p) => {
          const Icon = BRAND_ICONS[p.id] ?? GlobeIcon
          return (
            <label key={p.id} className="sns-field">
              <span className="sns-field-icon" aria-hidden="true"><Icon /></span>
              <span className="sns-field-hint">{p.hint}</span>
              <input
                type="text"
                aria-label={p.label}
                // i18n-ok: 入力する値そのものの見本（ハンドル/URLはASCII）
                placeholder={p.kind === 'url' ? 'yoursite.com' : 'yourhandle'}
                value={snsLinks[p.id] ?? ''}
                onChange={(e) => editProfile({ links: { ...snsLinks, [p.id]: e.target.value } })}
              />
            </label>
          )
        })}
      </div>
      {/* Other: arbitrary labelled links */}
      <div className="sns-custom">
        {snsCustom.map((c, i) => (
          <div key={i} className="sns-custom-row">
            <input
              type="text"
              aria-label={t('me.profileCustomLabel')}
              placeholder={t('me.profileCustomLabel')}
              className="sns-custom-label"
              value={c.label}
              onChange={(e) => editProfile({ custom: snsCustom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
            />
            <input
              type="text"
              inputMode="url"
              aria-label={t('me.profileCustomUrl')}
              // i18n-ok: URLの見本
              placeholder="https://…"
              value={c.url}
              onChange={(e) => editProfile({ custom: snsCustom.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
            />
            <button
              type="button"
              className="sns-custom-del"
              aria-label={t('me.profileRemoveLink')}
              title={t('me.profileRemoveLink')}
              onClick={() => editProfile({ custom: snsCustom.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-line sns-add"
          onClick={() => editProfile({ custom: [...snsCustom, { label: '', url: '' }] })}
        >
          + {t('me.profileAddLink')}
        </button>
      </div>
    </div>
    </>
  )
}

// Dashboard menus: gallery editing and profile/account editing are separate concerns
// Ids only — the labels are translated where they are rendered, since a module
// constant cannot call a hook.
// Only two top-level views remain (ユーザー指示 2026-07-30): the gallery (whose stage
// bar carries works/room/placement/publish/guestbook/profile) and account, reached
// from the top-right menu. There is no tab row anymore.
type MeTab = 'gallery' | 'account'

export default function MePage() {
  const t = useT()
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
  // Dashboard-wide autosave toast (single slot; each save refreshes it)
  const [toast, setToast] = useState<{ msg: string; n: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg = 'Saved') => {
    setToast((t) => ({ msg, n: (t?.n ?? 0) + 1 }))
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }, [])
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

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
      setLoadErr(t('me.loadFailed'))
      setGalleries([])
    }
    try {
      setUsage(await getStorageUsage(user.id))
    } catch {
      setUsage(null) // storage unconfigured or unreachable — hide the meter
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
      <AuthShell title={t('me.dashboard')}>
        <p className="auth-note">{t('me.notConfigured')}</p>
        <p className="auth-links">
          <LocaleLink href="/">{t('me.backHome')}</LocaleLink>
        </p>
      </AuthShell>
    )
  }

  return (
    <ToastContext.Provider value={showToast}>
    <main className="me-page">
      {toast && (
        <div className="me-toast" role="status" aria-live="polite" key={toast.n}>{toast.msg}</div>
      )}
      <div className="me-inner">
        <div className="me-top">
          <LocaleLink href="/" className="auth-logo">XIBIT360</LocaleLink>
          <TopActions>
            <LocaleLink className="btn-line" href="/explore">{t('me.explore')}</LocaleLink>
            {isAdmin && (
              <Link className="btn-line btn-gold" href="/admin">{t('me.admin')}</Link>
            )}
            {user && (
              <button className="btn-line" onClick={() => setTab('account')}>{t('me.tabAccount')}</button>
            )}
            {user && (
              <button className="btn-line" onClick={() => void signOut()}>{t('me.signOut')}</button>
            )}
          </TopActions>
        </div>

        {!user && checked && (
          <div className="me-card">
            <p className="me-note" style={{ marginTop: 0 }}>{t('me.notSignedIn')}</p>
            <div className="hako-actions">
              <Link className="btn-line" href="/signin">{t('common.signIn')}</Link>
              <Link className="btn-line" href="/signup">{t('me.createAccount')}</Link>
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
                    ? t('me.purchaseSuccess')
                    : t('me.purchaseCancelled')}
                </p>
                <button className="btn-line" onClick={() => setPurchaseReturn(null)}>{t('me.dismiss')}</button>
              </div>
            )}
            {/* The top-level tabs are gone (ユーザー指示 2026-07-30): guestbook and
                profile became stages inside the gallery, and the gallery is the only
                non-account view. Account is still reached from the top-right menu. */}
            {tab === 'gallery' && (
              <>
                <GuestImportCard />
                <section className="me-section">
                  {/* A bare heading only while there's no gallery card yet (loading / empty).
                      The card itself carries the stage bar and needs no separate header. */}
                  {(galleries === null || galleries.length === 0) && <h2>{t('me.myGallery')}</h2>}
                  {loadErr && <p className="me-error">{loadErr}</p>}
                  {galleries === null && !loadErr && <p className="me-note">{t('me.loading')}</p>}
                  {galleries !== null && !loadErr && galleries.length === 0 && (
                    <CreateCard onCreated={() => void reload()} />
                  )}
                  {(galleries ?? []).map((g) => (
                    <GalleryCard key={g.id} row={g} onChanged={() => void reload()} />
                  ))}
                  {galleries !== null && galleries.length > 0 && galleries.length < PLAN.galleries && (
                    <p className="me-note">
                      {t('me.moreGalleries', { count: PLAN.galleries - galleries.length })}
                    </p>
                  )}
                  {usage !== null && (
                    <p className="me-note">
                      {t('me.storage', {
                        used: `${(usage / 1024 / 1024).toFixed(1)} MB`,
                        total: `${Math.round(PLAN.storageBytes / 1024 / 1024)} MB`,
                      })}
                    </p>
                  )}
                </section>
              </>
            )}

            {tab === 'account' && (
              <section className="me-section">
                {/* Reached from the top-right menu, so the tab row shows no active
                    tab — this is the way back. */}
                <div className="me-section-head">
                  <h2>{t('me.tabAccount')}</h2>
                  <button className="btn-line" onClick={() => setTab('gallery')}>← {t('me.myGallery')}</button>
                </div>
                <AccountCard />
              </section>
            )}
          </>
        )}

        <footer className="artist-footer">
          <Link href="/terms">{t('footer.terms')}</Link>
          <LegalLink />
          <Link href="/privacy">{t('footer.privacy')}</Link>
        </footer>
      </div>
    </main>
    </ToastContext.Provider>
  )
}
