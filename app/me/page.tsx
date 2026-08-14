'use client'
// Dashboard: manage your gallery (create / rename / publish / delete), profile, and links.
// Multi-room since 2026-08-09: the free plan grants one room and each $25 purchase
// grants another (lib/limits → gradeForNewRoom). The RoomBar below picks which room the
// rest of this screen is editing; one room means it renders as a single static label,
// so nothing about the single-room screen changes until a second room exists.
import { createContext, useCallback, useContext, useDeferredValue, useEffect, useRef, useState , type ReactNode } from 'react'
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
import { InviteInbox, ParticipantsPanel } from '@/components/me/ExpoInvites'
import { listSubmittedArtworksForRoom, leaveExpo } from '@/lib/invites'
import PurchaseModal from '@/components/PurchaseModal'
import HelpModal from '@/components/HelpModal'
import TopActions from '@/components/TopActions'
import NotificationBell from '@/components/me/NotificationBell'
import ExpoManager from '@/components/me/ExpoManager'
import RoomExpoBadge from '@/components/me/RoomExpoBadge'
import { LockIcon, VideoIcon, InfoIcon, CopyIcon, CheckIcon } from '@/components/icons'
import { PRICE_SLOT, PRICE_PER_SLOT_CENTS, PRICE_VIDEO_PASS, PRICE_ROOM, PRICE_USD_CENTS, usd, expoRunOptions, type PaidKind } from '@/lib/pricing'
import {
  getExpoById,
  expoPhase,
  expoPurgeAt,
  expoPath,
  updateExpo,
  startExpoCheckout,
  setExpoRoomReady,
  EXPO_GRACE_DAYS,
  type Expo,
} from '@/lib/expos'
import { getEntitlements, isThemeUnlocked, isLayoutUnlocked, isTemplateUnlocked, unlockedFirst } from '@/lib/entitlements'
import { usePurchasedIds } from '@/lib/purchases'
import { useIsAdmin } from '@/lib/admin'
import { PLAN, MAX_WORKS_PER_ROOM, GALLERY_BGM_MAX_BYTES, tallyRooms, unbuiltRooms, poolCapacityOf } from '@/lib/limits'
import {
  listMyGalleries,
  listAllOwnedRooms,
  elsewherePlacedWorkIds,
  elsewherePlacedCount,
  getGalleryById,
  fetchProfileName,
  createGallery,
  updateGalleryDetails,
  updateGallerySlug,
  setMainRoom,
  mainRoomOf,
  SLUG_RE,
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
import { SNS_PLATFORMS, normalizeSnsValue, snsDisplayValue, snsMismatch, type CustomLink } from '@/lib/sns'
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
  listRoomArtworks,
} from '@/lib/cloud'
import {
  engagementSummary,
  listGuestbook,
  deleteGuestbookEntry,
  type EngagementSummary,
  type GuestbookEntry,
} from '@/lib/engagement'
import { track } from '@/lib/analytics'
import { loadImage } from '@/lib/upload'
import type { ArtworkData, CropAlign, PurchaseLink } from '@/lib/artworks'
import AuthShell from '@/components/auth/AuthShell'
import { LegalLink, LocaleLink, useT } from '@/components/I18nProvider'
import { renderMarkdown, hasMarkdown, ARTIST_TEXT_MD } from '@/lib/markdown'
import { usePending, useHasPending, usePendingKind } from '@/lib/pendingSave'

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

/** `<input type="datetime-local">` の `min` 用。**現地時刻**（UTCではない）を
 *  `YYYY-MM-DDTHH:mm` に切って返す — datetime-local はタイムゾーンを持たない文字列
 *  なので、そのまま `toISOString()`（常にUTC）を使うとずれる。UTCへの見かけ上の
 *  シフトで現地時刻を読ませる、よく使われる回避策（ユーザー指示 2026-08-10、
 *  合同展示の公開日時予約）。 */
function nowForDatetimeLocal(): string {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

/** `datetime-local` の入力欄はタイムゾーンを持たない文字列を読み書きするので、
 *  それが「どのタイムゾーンの時刻か」を添えないと世界中から来る利用者には基準が
 *  分からない（ユーザー指摘 2026-08-13）。ブラウザの現地タイムゾーンをラベルにする
 *  （例: "Asia/Tokyo (GMT+09:00)"）。 */
function localTimeZoneLabel(): string {
  const offsetMin = -new Date().getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  const gmt = `GMT${sign}${hh}:${mm}`
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz ? `${tz} (${gmt})` : gmt
  } catch {
    return gmt
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

// Dashboard-wide "Saved" toast. 自動保存をやめた（2026-08-13）ので、これが出るのは
// **保存ボタンを押して成功したとき**と、即時に反映する操作（アップロード・部屋の作成/
// 公開切替/削除）のとき。Provided by MePage.
const ToastContext = createContext<(msg?: string) => void>(() => {})
function useToast() {
  return useContext(ToastContext)
}

// Buying a room is an ACCOUNT-level action, but the moment that sells it is inside a
// room (the works stage, when this room can hold no more). MePage owns the offer —
// it holds the room list and the purchase count — and hands the opener down through
// this context, the same way the toast is shared.
const RoomOfferContext = createContext<(() => void) | null>(null)
function useRoomOffer() {
  return useContext(RoomOfferContext)
}


// The first thing a signed-in artist sees: their own face and name, not a form
// `topRight` は合同展示への導線（ユーザー指示 2026-08-10: `.me-top` の文字ボタン列に
// 埋もれていたのを、この行の右側の空き領域へ引き上げる）。
function Hero({
  topRight,
  expo,
}: {
  topRight?: React.ReactNode
  /** いま選んでいる部屋が合同展示の部屋なら、その展示。**通常展示の部屋・未取得なら
   *  null**（ユーザー指摘 2026-08-13: 合同展示の部屋を見ているのに個人の `/@username`
   *  が出ていた ── サブ行は「いま見ている部屋がどこで開いているか」を言う場所なので、
   *  合同展示のときはその展示のURLに差し替える）。 */
  expo?: Expo | null
}) {
  const t = useT()
  const user = useGallery((s) => s.user)!
  const displayName = useGallery((s) => s.profileDisplayName)
  const avatarUrl = useGallery((s) => s.profileAvatarUrl)
  const username = useGallery((s) => s.profileUsername)
  const name = displayName || user.displayName
  const h = new Date().getHours()
  const greet =
    h < 5 ? t('me.greetLate') : h < 11 ? t('me.greetMorning') : h < 18 ? t('me.greetAfternoon') : t('me.greetEvening')
  const expoUrl = expo ? expoPath(expo.slug) : null
  return (
    <div className="me-hero">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img crossOrigin="anonymous" className="me-hero-avatar" src={avatarUrl} alt="" />
      ) : (
        <div className="me-hero-avatar empty">{name.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="me-hero-text">
        <div className="me-hero-greet">{greet}, {name}.</div>
        <p className="me-hero-sub">
          {expoUrl ? (
            <>
              {t('me.livesAtExpo')}{' '}
              <a href={expoUrl} target="_blank" rel="noreferrer">{expoUrl}</a>
            </>
          ) : username ? (
            <>
              {t('me.livesAt')}{' '}
              <a href={`/@${username}`} target="_blank" rel="noreferrer">/@{username}</a>
            </>
          ) : (
            t('me.pickUsernameHint')
          )}
        </p>
      </div>
      {topRight && <div className="me-hero-actions">{topRight}</div>}
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
        {/* **文字数制限を付けない**（ユーザー指示 2026-08-13「この入力欄に文字数制限は
            不要です」）。以前は 200 字で、書ける量が理由も見えないまま切られていた。
            3Dの板には焼かれない（板はタイトルと作家名だけ・`makeTitleTexture`）ので、
            長くても壁からはみ出すことはない。 */}
        <textarea
          rows={3}
          placeholder={t('me.statementPlaceholder')}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
        />
        <small className="me-field-hint">{t('me.markdownOk')}</small>
      </label>
      <MarkdownPreview value={statement} />
      <div className="hako-actions">
        <button className="btn-line" disabled={busy} onClick={() => setStep(1)}>← {t('me.createBack')}</button>
        <button className="btn-line" disabled={busy} onClick={() => void create()}>
          {busy ? t('common.saving') : t('me.createOpen')}
        </button>
      </div>
    </div>
  )
}

// The stage tabs are the ONLY navigation now (the old top-level gallery/guestbook/
// profile tabs are gone — ユーザー指示 2026-07-30). The publish flow (works → room →
// placement → publish) leads, then the two housekeeping stages (guestbook, profile).
// Order is visible but never enforced — every stage stays reachable.
// `participants` は合同展示の部屋（`row.expo_id` が付いている）だけに出す
// （ユーザー指示 2026-08-10: 通常展示と合同展示の部屋編集画面を「タブの数が違うだけ」
// の同じ形にする。招待の管理は `ExpoManager` から部屋編集の中へ移した）。
//
// **モジュール直下に置く**（GalleryCardの中ではない）: `stage` はMePage側に持たせて
// いる（下記GalleryCardのpropsコメント参照）ので、その型もページ側から使える必要がある。
const STAGES = ['works', 'room', 'placement', 'participants', 'publish', 'profile'] as const
type Stage = (typeof STAGES)[number]
/** 選んでいたタブの保存先。**部屋をまたいで同じ**にする（部屋を切り替えても見ている
 *  面は同じままにしたい）。値が壊れていたら黙って既定へ落ちる（`STAGES` で検査する）。 */
const STAGE_KEY = 'xibit360.me.stage'
/** 最後に開いていた部屋の保存先（ユーザー決定 2026-08-14）。合同展示の部屋も部屋タブに
 *  並ぶようになったので、リロードで玄関へ戻されると「さっき編集していた展示用の部屋」を
 *  毎回探し直すことになる。保存した id が今の一覧に無ければ黙って捨てる。 */
const ROOM_KEY = 'xibit360.me.room'
/** 「この口座は一度でも部屋を持った」の記録。**ユーザーidを後ろに付けて使う**
 *  （同じタブでアカウントを切り替えたときに前の人の事実を持ち越さない）。0室のときに
 *  部屋を自動で作るか、それとも作成ウィザードを出すかの判断だけに使う。 */
const HAD_ROOM_KEY = 'xibit360.me.hadroom'
// `allOwnedRooms`が未取得のときの安定した空集合（`EMPTY_OVERRIDES`と同じ作法。
// レンダーごとに`new Set()`すると子コンポーネントの参照比較を毎回変えてしまう）。
const EMPTY_ELSEWHERE: ReadonlySet<string> = new Set()

// The gallery card IS the gallery workbench: status + publish on top, then the
// works library on the left and the real-3D preview with every design control —
// per-work title/caption/frame and the room-wide theme/layout — on the right.
function GalleryCard({
  row,
  onChanged,
  roomCount,
  isMain,
  roomAdd,
  rooms,
  frontDoorId,
  onSwitchRoom,
  poolCapacity,
  placedElsewhere,
  placedElsewhereCount,
  stage,
  onStageChange,
  onOpenRoom,
}: {
  row: GalleryRow
  onChanged: () => void
  /** 「新しい部屋をつくる」／購入の誘い。**部屋ステージの中に置く**（ユーザー指示
   *  2026-08-09「部屋の中に追加して欲しい」）。判定と処理はページ側が持ち、ここは
   *  置き場所だけを提供する ── 部屋数・購入状況はダッシュボード全体の話で、
   *  1つの部屋の設定ではないため。 */
  roomAdd?: ReactNode
  /** How many rooms this account owns. Multi-room controls (the URL slug, "make this
   *  the front door") only appear once a second room exists — with one room they would
   *  ask about a distinction that does not exist yet. */
  roomCount: number
  /** Whether `/@username` renders THIS room. Resolved by the caller through
   *  `mainRoomOf()`, so the pre-0036 fallback ("oldest room") is decided in one place. */
  isMain: boolean
  /** 部屋の切替タブに出す一覧（自分＝通常展示の部屋だけ。合同展示の部屋は含まない）。
   *  **ユーザー指示 2026-08-10**: 以前は全ステージの上に一律で出していたが、部屋の
   *  中身が変わるのは「部屋」と「配置」ステージだけなので、そこにだけ置く。 */
  rooms?: GalleryRow[]
  /** `/@username` が開く部屋のid（切替タブの目印用）。 */
  frontDoorId?: string | null
  /** タブを押したときの切替。トラッキングと `roomId` の更新は呼び手（ページ側）が持つ。 */
  onSwitchRoom?: (id: string) => void
  /** 「参加者」タブから、承諾済みの作家の自動生成の部屋を直接開く（migration 0062）。
   *  `onSwitchRoom` と分けたのは意味が違うから ── こちらは自分の通常展示の部屋の
   *  あいだの切替ではなく、同じ展示の**他の作家**の部屋へ飛ぶ。 */
  onOpenRoom?: (id: string) => void
  /** 作品スロットの合計（口座内の全部屋の`work_cap`の合計、合同展示の部屋も含む）。
   *  ユーザー指摘 2026-08-11: 部屋ごとに別々の数字を考えず「共通」で扱いたい ──
   *  部屋間で手動で「移動」する案（migration 0052）は撤回し、代わりに全部屋の
   *  `work_cap`を合算した1つの数字を作品タブの上限に使う（DBのwork_cap自体は
   *  購入・等級の記帳としてそのまま残す。集計はアプリ側のみ）。未取得のときは
   *  `null`＝この部屋自身のwork_capにフォールバックする。 */
  poolCapacity: number | null
  /** 口座内の他の部屋（この部屋以外）の配置に載っている作品idの集合。配置タブの
   *  トレイで「この作品は別の部屋にも掛かっている」を示すために使う（ユーザー指示
   *  2026-08-11）。 */
  placedElsewhere: ReadonlySet<string>
  /** 口座内の他の部屋に**今置かれている点数**（配置枠、重複あり）。配置タブの共有
   *  プール上限に使う ── `placedElsewhere.size`（作品idの集合）は同じ作品を複数の
   *  他室に掛けていると1回しか数えないため、容量計算にはこちらを使う（別視点レビュー
   *  指摘 2026-08-12）。 */
  placedElsewhereCount: number
  /** いま表示中のステージ。**ページ側(MePage)に持たせる**（ユーザー指摘 2026-08-11:
   *  部屋を切り替えると「作品」タブに戻ってしまう）。`GalleryCard`は`key={current.id}`
   *  で部屋が変わるたびに再マウントされる（他のper-room入力欄をrowの新しい値で
   *  初期化し直すため必要）ので、`stage`をこの中のuseStateに置くと部屋切替のたびに
   *  初期値'works'へ戻っていた。ページ側に置けば再マウントを跨いで持続する。 */
  stage: Stage
  onStageChange: (s: Stage) => void
}) {
  const roomOffer = useRoomOffer()
  const t = useT()
  // 自動保存をやめたので、編集は**保留の台帳**へ積む（`lib/pendingSave`）。
  // 保存するのは上帯の `SaveAllButton` を押したときだけ（ユーザー指示 2026-08-13）。
  const mark = usePending((s) => s.mark)
  const detailsPending = usePendingKind('details')
  const dirty = useHasPending()
  const user = useGallery((s) => s.user)!
  const username = useGallery((s) => s.profileUsername)
  const profileDisplayName = useGallery((s) => s.profileDisplayName)
  const cloudArtworks = useGallery((s) => s.cloudArtworks)
  const updateSettings = useGallery((s) => s.updateSettings)
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const toast = useToast()

  // 合同展示の部屋は専用の作品プール（migration 0061・ユーザー決定 2026-08-13）。
  // 口座全体の共有ライブラリ（`works`）とは別物 ── 部屋を合同展示に切り替えると
  // それがそのまま「作品」タブに出て「今まで使っている設定が反映されている」ように
  // 見えて混乱するという指摘を受け、その部屋だけ0から積む形にした。`works` が以下の
  // 全ての参照先（作品タブ・配置トレイ・rebuildPlacements）を差し替える1点。
  /** **この部屋は自分のものか。** 主催者は「参加者」タブから参加作家の部屋を開ける
   *  （migration 0062 の `galleries_select_expo_owner`）ので、`row.owner_id` が自分とは
   *  限らない。他人の部屋は**見るだけ**（DB側に書き込みのポリシーは1つも無い）。 */
  const isMyRoom = row.owner_id === user.id
  /** 他人の部屋を見ているときの、その部屋の持ち主の名前（プレートに出す作家名）。
   *  `profiles_select_all` は `using (true)` なので追加のポリシーは要らない。 */
  const [roomOwnerName, setRoomOwnerName] = useState('')
  useEffect(() => {
    if (isMyRoom) {
      setRoomOwnerName('')
      return
    }
    let alive = true
    void fetchProfileName(row.owner_id).then((n) => {
      if (alive) setRoomOwnerName(n)
    }).catch(() => {
      if (alive) setRoomOwnerName('')
    })
    return () => {
      alive = false
    }
  }, [isMyRoom, row.owner_id])
  // 自分の部屋なら自分の名前、他人の部屋ならその持ち主の名前をプレートに配る
  // （主催者が参加作家の部屋を見ているときに、自分の名前が作品に付くのを防ぐ）。
  const artistName = isMyRoom ? (profileDisplayName || user.displayName) : roomOwnerName
  const [roomArtworks, setRoomArtworks] = useState<ArtworkData[] | null>(null)
  /** 何回目の取得か。**遅れて返った古い応答で新しい結果を上書きしないため**（2巡目の
   *  別視点レビューで検出）。作家名があとから届く作りにしたので、1つの部屋で取得が
   *  2回走る ── 順序が入れ替わると、名前の入っていない方が最後に着いて**プレートから
   *  作家名が消えたまま固定される**（直したはずの不具合がそのまま出る）。 */
  const roomArtGen = useRef(0)
  const refreshRoomArtworks = useCallback(async () => {
    if (!row.expo_id) return
    const gen = ++roomArtGen.current
    try {
      const list = await listRoomArtworks(row.id, artistName)
      if (gen === roomArtGen.current) setRoomArtworks(list)
    } catch {
      if (gen === roomArtGen.current) setRoomArtworks([])
    }
  }, [row.expo_id, row.id, artistName])
  // `artistName` を deps に入れる（別視点レビューで検出）。他人の部屋を開いたときの
  // 持ち主の名前は**あとから届く**ので、入れないと最初の1回（名前が空）のまま固定され、
  // **主催者の画面で参加作家の作品に作家名が付かない**。届いたら読み直す。
  useEffect(() => {
    if (row.expo_id) void refreshRoomArtworks()
    else setRoomArtworks(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.expo_id, row.id, artistName])
  const works: ArtworkData[] = row.expo_id ? (roomArtworks ?? []) : cloudArtworks
  const refreshWorks = row.expo_id ? refreshRoomArtworks : refreshCloud
  // 合同展示の部屋は専用プールなので、口座の共有プールの計算（`poolCapacity`・
  // `placedElsewhere`・`placedElsewhereCount` — いずれも呼び手が通常展示の部屋の
  // あいだで計算した値）はここでは無視し、その部屋自身の`work_cap`だけで完結させる。
  const effectivePoolCapacity = row.expo_id ? row.work_cap : poolCapacity
  const effectivePlacedElsewhere: ReadonlySet<string> = row.expo_id ? EMPTY_ELSEWHERE : placedElsewhere
  const effectivePlacedElsewhereCount = row.expo_id ? 0 : placedElsewhereCount
  const [usernameInput, setUsernameInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState(row.title)
  const [slugInput, setSlugInput] = useState(row.slug)
  const [statementInput, setStatementInput] = useState(row.statement)
  const [copied, setCopied] = useState(false)
  const [embedCopied, setEmbedCopied] = useState(false)
  const [showEmbed, setShowEmbed] = useState(false)
  const [stats, setStats] = useState<EngagementSummary | null>(null)
  const [uploading, setUploading] = useState(false)
  // `stage`/`setStage`は今はpropで受け取る（上のprops型コメント参照。部屋切替を
  // 跨いで持続させるためページ側に持たせた）。ローカルのuseStateは持たない。
  const setStage = onStageChange
  // この部屋が属する展示（合同展示の部屋のときだけ）。会期・題名を「公開」ステージで
  // 出すため。通常展示の部屋では常に null。
  const [expo, setExpo] = useState<Expo | null>(null)
  useEffect(() => {
    if (!row.expo_id) {
      setExpo(null)
      return
    }
    let alive = true
    void getExpoById(row.expo_id).then((x) => {
      if (alive) setExpo(x)
    }).catch(() => {
      if (alive) setExpo(null)
    })
    return () => {
      alive = false
    }
  }, [row.expo_id])
  // 自分がこの展示の主催者かどうか（migration 0062）。参加作家にも自分の部屋がある
  // ので、「参加者」タブ・会期を選んでの決済は主催者だけに絞る ── 参加者側の
  // 「公開」タブは決済ではなく「準備できた」トグルに変わる。
  //
  // **`expo` が未取得のうちは「主催者ではない」に倒す**（2026-08-14 に反転させた）。
  // 以前は `!expo || …` で主催者扱いにしていたが、それだと**参加作家の画面に一瞬
  // 「参加者」タブが出て、「準備できた」トグルは出ない**。しかも `getExpoById` が
  // 失敗すると `expo` は null のまま固定されるので、**参加作家がトグルに永久に
  // 辿り着けない**（招待があれば `expos_select_invited`(0047) で読めるはずだが、
  // 読めなかったときに開く側へ倒す理由が無い）。主催者側で「参加者」タブが一瞬
  // 遅れて出るのは、その逆より軽い。
  const isOrganizer = !!expo && expo.ownerId === user.id
  // 展示から外した直後、または自分が主催者でない展示で、タブが「参加者」に
  // 居座って中身の無い画面にならないように。
  // **`expo` を読み終えてから判定する** ── `isOrganizer` を安全側に倒したので、
  // 読み込み中に判定すると**主催者が「参加者」タブを開いていても毎回「作品」へ
  // 弾き出される**（タブの記憶が効かなくなる）。
  useEffect(() => {
    if (stage !== 'participants') return
    if (!row.expo_id) {
      setStage('works')
      return
    }
    if (expo && expo.ownerId !== user.id) setStage('works')
  }, [stage, row.expo_id, expo, user.id])
  // 合同展示の公開日時の予約（`<input type="datetime-local">` の値。空欄=今すぐ。
  // ユーザー指示 2026-08-10、上限なし）。
  const [scheduleInput, setScheduleInput] = useState('')
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
  const [purchaseLinksInput, setPurchaseLinksInput] = useState<PurchaseLink[]>([])
  const [priceInput, setPriceInput] = useState('')
  const [cropAlignInput, setCropAlignInput] = useState<CropAlign>('center')
  const [widthInput, setWidthInput] = useState('')
  const [heightInput, setHeightInput] = useState('')
  // The W×H cm fields only show in "custom" mode; a preset shows just the dropdown + swap.
  const [sizeCustom, setSizeCustom] = useState(false)
  const [mediumInput, setMediumInput] = useState('')
  // Per-work text autosaves (like the exhibition title/statement) — no Save button.
  const [purchaseItem, setPurchaseItem] = useState<
    // `qty` is only read in capacity mode: tapping a locked spot on the placement
    // map knows how many slots it takes to reach that spot, so the stepper opens
    // on that number instead of 1.
    { kind: PaidKind | 'capacity' | 'video_pass'; key: string; label: string; qty?: number } | null
  >(null)
  const owned = usePurchasedIds(user.id)
  const entitlements = getEntitlements(user.id, owned)
  // One tap-point for all five places that open the modal (locked theme, locked
  // layout, custom layout, capacity, video pass) — instrumenting the state they
  // set rather than each button keeps the funnel's first step honest when a new
  // entry point is added later.
  useEffect(() => {
    if (!purchaseItem) return
    track('checkout_modal_open', {
      kind: purchaseItem.kind,
      item_key: purchaseItem.key,
      from_stage: stage,
      qty: purchaseItem.qty,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseItem])
  const [design, setDesign] = useState<DesignOverrides>(() => normalizeDesignOverrides(row.design_overrides))
  const [logoUploading, setLogoUploading] = useState(false)
  // Ambient BGM (§P3-12): the gallery row's bgm_url is the source of truth; mirror it locally
  const [bgmUrl, setBgmUrl] = useState<string | null>(row.bgm_url ?? null)
  const [bgmBusy, setBgmBusy] = useState(false)
  // Manual slot placement (§11.13): local state seeded from the row (the source of
  // truth the dashboard reads), debounce-saved through the same path as theme/layout
  // so a placement edit and a layout change never race over one gallery row.
  const [placement, setPlacement] = useState<(string | null)[]>(() => normalizeArrangement(row.arrangement))
  // 合同展示（migration 0047）。`guests` はこの部屋が属する展示に他の作家が出した作品で、
  // 掛けられるが自動では並ばない。
  // ここの `guests` は**表示だけ**に使う（配置トレイ）。保存時は
  // `rebuildPlacements` が自分で取り直す — この state を保存経路に渡すと、読み込みに
  // 失敗したときや初回描画の取得前に「提出ゼロ」として壁から消してしまう。
  //
  // **通常の部屋では1往復で空が返る**（`expo_id` が null ＝ 他作家の作品が入る道が無い）。
  // 招待の管理は合同展示タブ（`ExpoManager`）に移した ── 招待は展示に対するもので、
  // 部屋ごとに繰り返す話ではない（0047 / DECISIONS 2026-08-10）。
  const [guests, setGuests] = useState<ArtworkData[]>([])
  const reloadGuests = useCallback(async () => {
    try {
      setGuests(await listSubmittedArtworksForRoom(row.id))
    } catch (e) {
      // 0047 未適用のDBでは表が無い。合同展示が無いのと同じ扱いにする（個展を壊さない）。
      // **前の値は消さない** — 読めなかっただけかもしれず、トレイから他作家の作品が
      // 消えると「取り下げられた」と誤解する。
      console.error('could not load submissions (is migration 0047 applied?):', e)
    }
  }, [row.id])
  useEffect(() => {
    void reloadGuests()
  }, [reloadGuests])
  // Per-work design (frame / mat / hanging / caption / light), keyed by artwork id and
  // scoped to THIS ROOM. These live in the room's own placements, not in the zustand
  // store: the store carries one set of maps for the whole browser, which the store only
  // ever loads from the front-door room (`refreshMyGallery` → `getMyGalleryRow`). Reading
  // and writing them there showed room 1's framing while editing room 2 and saved room 2's
  // edits onto room 1 — the same class of bug as reading `row` from the store would be.
  // Same work can be framed differently in two rooms, which is the point of a second room.
  const [overrides, setOverrides] = useState<PlacementOverrides>(EMPTY_OVERRIDES)
  /** テーマ・間取り・既定の額装の**保存待ちの下書き**（`view` で `row` に重ねる）。 */
  const [spaceDraft, setSpaceDraft] = useState<Partial<GalleryRow>>({})
  /** 配置タブの間取り選択を開いているか（ユーザー選択 2026-08-13・A案）。**既定は閉じる** ──
   *  間取りは一度決めたらまた変えないのに、5つの大きなチップが主役の配置図を画面の下へ
   *  押し出していた。畳んで1行にすると、タブを開いた瞬間に配置図が見える。 */
  const [layoutOpen, setLayoutOpen] = useState(false)
  /** **保存待ちを含めた「いまの部屋の設定」。** `row` は保存済みの値なので、テーマや間取りを
   *  押した瞬間の見た目・3Dプレビューはこちらを見る（ユーザー決定 2026-08-13・A案:
   *  プレビューは即時・公開ページは保存後）。保存ボタンを押すと `row` が追いつく。
   *
   *  **宣言はこの位置**（`spaceDraft` の直後）でなければならない ── 下の `useState` の
   *  初期値がこれを読むので、後ろで宣言すると初回レンダリングで TDZ の
   *  `ReferenceError` になりダッシュボードが真っ白になる（別視点レビューで検出。
   *  tsc とビルドは両方通る）。 */
  const view = { ...row, ...spaceDraft }
  /** 保存の処理は非同期に走るので、**走る瞬間の下書き**を読めるようにしておく。
   *  ここを `row` のままにすると、テーマの保存と配置の保存が同時に待っているとき、
   *  後から走る側が**古いテーマで行を上書きして変更が消える**。 */
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    let alive = true
    fetchPlacementOverrides(row.id)
      .then((o) => alive && setOverrides(o))
      .catch(() => {
        /* leave the room's defaults showing rather than another room's overrides */
      })
    return () => {
      alive = false
    }
  }, [row.id])
  // Every local placement edit bumps editGen; a save stamps savedGen with the gen it
  // persisted. While editGen ≠ savedGen there's an unsaved (or in-flight) local edit, so
  // the re-seed effect must not overwrite the map from the row — otherwise a save's row
  // refresh reverts a drop the user made during its round-trip (a boolean "dirty" flag
  // fails here: an earlier save's completion would clear it while a newer edit is pending).
  const editGen = useRef(0)
  const savedGen = useRef(0)
  // Custom-layout knobs (width/depth/centre wall), editable right here in the dashboard.
  const [custom, setCustom] = useState<CustomLayoutParams>(() => normalizeLayoutParams(view.layout_params))

  const selected = selectedId ? works.find((a) => a.id === selectedId) : undefined
  const selectedIndex = selected ? works.indexOf(selected) : 0
  /** いま開いている作品に未保存があるか。**`selectedId` の宣言より後で呼ぶこと** ──
   *  zustand のセレクタは描画中にその場で実行されるので、上の方に置くと
   *  `Cannot access 'selectedId' before initialization` でダッシュボードが全滅する
   *  （2026-08-13 に実際に本番へ出してしまった。`tsc` はクロージャの中を見ないので通る）。 */
  const workPendingKey = usePending((s) => (selectedId ? s.tasks.has(`work:${selectedId}`) : false))

  // Effective per-work design: the override when set, else the gallery default
  const frame = (selected && overrides.frames[selected.id]) || view.frame_default
  const mat = (selected && overrides.mats[selected.id]) || view.mat_default
  const hanging = (selected && overrides.hangings[selected.id]) || view.hanging_default
  const captionKey = (selected && overrides.captions[selected.id]) || view.caption_default
  // Effective lighting for the selected work: 'follow' means the room's default.
  const lightKey = (() => {
    const k = selected ? overrides.lights[selected.id] : undefined
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
  const roomArt = works.find((a) => a.id === row.cover_artwork_id) ?? works[0]
  const roomSrc = roomArt
    ? roomArt.kind === 'video'
      ? roomArt.poster
      : roomArt.poster ?? roomArt.src
    : undefined

  // If the edited work is deleted (here or on another device), close the sheet
  useEffect(() => {
    if (selectedId && !works.some((a) => a.id === selectedId)) setSelectedId(null)
  }, [selectedId, works])

  // The works stage always has one work under the editor, so its fields are visible
  // without hunting for what to tap first (ユーザー指示 2026-07-30). The placement
  // stage does NOT pre-select: there you pick a spot on the map.
  useEffect(() => {
    if (stage !== 'works') return
    if (selectedId && works.some((a) => a.id === selectedId)) return
    setSelectedId(works[0]?.id ?? null)
  }, [stage, works, selectedId])

  // The plate fields follow whichever work is selected
  useEffect(() => {
    setTitleInput(selected?.title ?? '')
    setCaptionInput(selected?.desc ?? '')
    setPurchaseLinksInput(selected?.purchaseLinks ?? [])
    setPriceInput(selected?.price ?? '')
    setCropAlignInput(selected?.cropAlign ?? 'center')
    setWidthInput(selected?.widthCm ? String(selected.widthCm) : '')
    setHeightInput(selected?.heightCm ? String(selected.heightCm) : '')
    // Start in preset mode when the saved size matches a standard preset; otherwise
    // (a non-standard size, or none yet) open the custom fields so they're ready to type.
    setSizeCustom(matchPreset(selected?.widthCm, selected?.heightCm) === null)
    setMediumInput(selected?.medium ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  // 題名と展示情報。**自動保存はしない**（ユーザー指示 2026-08-13）── 打った内容は
  // すぐ画面に出るが、DBへ書くのは上帯の保存ボタンを押したときだけ。書きかけが
  // 公開中の部屋にそのまま出てしまうのを止めるため。以下6経路すべて同じ形。
  function editDetails(next: { title?: string; statement?: string }) {
    if (next.title !== undefined) setNameInput(next.title)
    if (next.statement !== undefined) setStatementInput(next.statement)
    const title = next.title ?? nameInput
    const statement = next.statement ?? statementInput
    mark('details', null, async () => {
      await updateGalleryDetails(row.id, { title, statement })
      await refreshMyGallery()
      onChanged()
    })
  }

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

  // `/@name` is the front-door room's URL; every other room hangs off it as
  // `/@name/[slug]` (ユーザー決定 2026-08-09 — one URL for the artist, sub-rooms
  // underneath). With a single room `is_main` is true (or absent on a pre-0036 DB and
  // this room is the oldest either way), so this stays exactly the `/@name` it was.
  const origin = typeof window !== 'undefined' ? location.origin : ''
  const publicUrl = origin && username ? `${origin}/@${username}${isMain ? '' : `/${row.slug}`}` : ''
  // Embeddable iframe: ?embed=1 trims the HUD to a back-link and opens outbound
  // links in a new tab. 16:10 keeps the walk usable in a blog's content column.
  const embedSrc = publicUrl ? `${publicUrl}?embed=1` : ''
  const embedCode = embedSrc
    ? `<iframe src="${embedSrc}" width="100%" height="600" style="border:0;border-radius:12px;aspect-ratio:16/10;max-width:100%" allowfullscreen loading="lazy" title="Xibit360 — ${(isPlaceholderTitle(row.title) ? t('me.embedFallbackTitle') : row.title).replace(/"/g, '&quot;')}"></iframe>`
    : ''

  /** Rename this room's path segment (`/@name/[slug]`). Only reachable on a sub-room —
   *  the front-door room IS `/@name` and has no segment to show. */
  async function saveSlug() {
    const next = slugInput.trim().toLowerCase()
    if (!SLUG_RE.test(next)) {
      alert(t('me.roomSlugInvalid'))
      return
    }
    await run(t('me.roomSlugSave'), () => updateGallerySlug(row.id, next))
  }

  /** Make this room the one `/@name` opens on. The room that WAS the front door keeps
   *  its own slug, so its URL becomes `/@name/[slug]` — the old `/@name` link still
   *  works, it just lands on a different room now, which is the whole point. */
  async function makeFrontDoor() {
    await run(t('me.frontDoorMake'), () => setMainRoom(row.id))
  }

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

  // Per-work design may have been set on another device since this room was loaded —
  // re-read the room's placements and lay our own (newer) edits on top, or a rebuild
  // here would wipe the other device's work. Both sides are THIS room's, keyed by
  // `row.id`, so nothing from another room can leak in.
  async function mergedOverrides(): Promise<PlacementOverrides> {
    const saved = await fetchPlacementOverrides(row.id).catch(() => overrides)
    return {
      frames: { ...saved.frames, ...overrides.frames },
      mats: { ...saved.mats, ...overrides.mats },
      hangings: { ...saved.hangings, ...overrides.hangings },
      captions: { ...saved.captions, ...overrides.captions },
      lights: { ...saved.lights, ...overrides.lights },
    }
  }

  async function togglePublic() {
    if (!row.is_public && works.length === 0) {
      // The single most common reason a finished-looking room never goes live.
      track('me_publish_blocked', { reason: 'no_works' })
      alert(t('me.needWorkAlert'))
      return
    }
    const going = !row.is_public
    await run(row.is_public ? 'Making private' : 'Publishing', async () =>
      // 公開の切替は即時（ユーザー決定 2026-08-13）。ただし**未保存の下書きを含めて**公開
      // する ── `row`（保存済み）だけを見ると、テーマを変えてから公開した人が「変える前の
      // 部屋」を公開することになる。
      setGalleryPublic(row, going, await pendingSettings(), works)
    )
    track(going ? 'me_publish_on' : 'me_publish_off', {
      works: works.length,
      theme: view.theme,
      layout: view.layout,
    })
  }

  /** 参加作家の「準備できた」トグル（migration 0062）。オンで主催者に通知が届く。
   *  `row.expo_id` の部屋でしか呼ばれない（呼び手のボタンがそこでしか出ない）。 */
  async function toggleReady() {
    const next = !row.expo_ready_at
    await run(t('invite.readyToggleLabel'), () => setExpoRoomReady(row.id, next))
    track(next ? 'expo_room_ready_on' : 'expo_room_ready_off', {})
  }

  // テーマ・間取り・既定の額装。**押した瞬間は下書きに入るだけ**で、DBへ書くのは保存
  // ボタンを押したとき（ユーザー指示 2026-08-13）。画面と3Dプレビューは `view` を見るので
  // 見た目はすぐ変わる。
  function setSpace(partial: Partial<Pick<ReturnType<typeof rowToSettings>, 'theme' | 'layout' | 'frame' | 'mat' | 'hanging' | 'caption'>>) {
    // 設定のキー（`frame`）と行の列名（`frame_default`）は別物なので、ここで移し替える
    const toRow: Partial<GalleryRow> = {}
    if (partial.theme !== undefined) toRow.theme = partial.theme
    if (partial.layout !== undefined) toRow.layout = partial.layout
    if (partial.frame !== undefined) toRow.frame_default = partial.frame
    if (partial.mat !== undefined) toRow.mat_default = partial.mat
    if (partial.hanging !== undefined) toRow.hanging_default = partial.hanging
    if (partial.caption !== undefined) toRow.caption_default = partial.caption
    setSpaceDraft((d) => ({ ...d, ...toRow }))
    mark('space', null, async () => {
      const s = await pendingSettings()
      await saveGallerySpace(row.id, s)
      if (row.is_public) await rebuildPlacements(row.id, s, works)
      await refreshMyGallery()
      // **下書きは畳まない**（別視点レビューで検出）。`refreshMyGallery()` の後は行が同じ
      // 値を持つので下書きは同じものを重ねているだけ。逆に空にすると、**保存している最中に
      // 入った変更（新しい間取り等）を消してしまう** ── その変更の保存タスクは残るのに、
      // 読む下書きが空なので古い値を書き戻すことになる。
      onChanged()
    })
  }

  /** 行に書き込む保存が共通で使う「いま保存すべき設定」。**走る瞬間の下書きを読む**ので、
   *  テーマ・配置・間取りの保存が同時に待っていても、どれが最後に走っても同じ設定になる。 */
  async function pendingSettings(extra?: Partial<ReturnType<typeof rowToSettings>>) {
    return { ...rowToSettings(viewRef.current, await mergedOverrides()), ...extra }
  }

  // Design Tools (§11.5/§11.8) — purely cosmetic, so this skips setSpace's
  // placement rebuild entirely. Debounced like the title/statement autosave:
  // colour pickers/sliders fire on every drag frame, not just on commit.
  function editDesign(partial: Partial<DesignOverrides>) {
    const next = { ...design, ...partial }
    setDesign(next)
    // **`space` とは別の枠**（別視点レビューで検出）。同じ枠にすると、テーマを変えた
    // あとに色を触るだけでテーマの保存が置き換えられて消える。
    mark('design', null, async () => {
      await saveDesignOverrides(row.id, next)
      await refreshMyGallery()
    })
  }

  // Re-seed placement when the row's saved arrangement changes (another device edits it,
  // or our own save round-trips), but never clobber an unsaved/in-flight local edit — a
  // drag the user made while a save was in flight must survive that save's row refresh.
  useEffect(() => {
    if (editGen.current !== savedGen.current) return
    setPlacement(normalizeArrangement(row.arrangement))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(row.arrangement)])

  /**
   * Per-work design autosave, scoped to this room.
   *
   * Persists through `rebuildPlacements(row.id)` — the same row-based path as placement
   * and theme edits — rather than through the store's debounced sync, which writes to
   * `myGallery.id` (always the front-door room) and would land a sub-room's framing on
   * room 1. Only touches the placements: the room's DEFAULT framing lives on the
   * gallery row and is not what a per-work chip changes.
   *
   * A private room has no placements to rebuild yet, so the edit stays in this state
   * until it is published — exactly how `editPlacement` behaves for the same reason.
   */
  function editOverrides(partial: Partial<PlacementOverrides>) {
    const next = { ...overrides, ...partial }
    setOverrides(next)
    mark('override', null, async () => {
      if (row.is_public) await rebuildPlacements(row.id, rowToSettings(viewRef.current, next), works)
    })
  }

  // Manual placement autosave (§11.13): optimistic local update, then persist through
  // the same rowToSettings → saveGallerySpace(+rebuildPlacements) path as theme/layout.
  function editPlacement(next: (string | null)[]) {
    const gen = ++editGen.current
    setPlacement(next)
    mark('place', null, async () => {
      const s = await pendingSettings({ arrangement: next })
      await saveGallerySpace(row.id, s)
      if (row.is_public) await rebuildPlacements(row.id, s, works)
      // Stamp BEFORE the row refresh: this gen is now the persisted truth, so if no
      // newer edit arrived the re-seed may adopt the refreshed row.
      savedGen.current = gen
      await refreshMyGallery()
      onChanged()
    })
  }

  // Custom layout size autosave: optimistic local update, then persist the layout_params
  // through the same saveGallerySpace(+rebuildPlacements) path. Debounced because the
  // sliders fire on every drag frame. Resizing changes the slot count, so public rooms
  // rebuild their placements.
  useEffect(() => {
    setCustom(normalizeLayoutParams(view.layout_params))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(view.layout_params)])
  function editCustom(partial: Partial<CustomLayoutParams>) {
    const next = normalizeLayoutParams({ ...custom, ...partial })
    setCustom(next)
    mark('custom', null, async () => {
      const s = await pendingSettings({ layout: 'custom', layoutParams: next })
      await saveGallerySpace(row.id, s)
      if (row.is_public) await rebuildPlacements(row.id, s, works)
      await refreshMyGallery()
      onChanged()
    })
  }
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
      await refreshWorks()
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
    const startedAt = Date.now()
    const bytes = Array.from(files).reduce((n, f) => n + f.size, 0)
    track('me_work_upload_start', { count: files.length, bytes })
    try {
      // ライブラリの上限は口座全体の合計（ユーザー指摘 2026-08-11: 50枠に増やしても
      // このロジックだけ`row.work_cap`単独を見ていたため15枚超のアップロードで
      // 「上限に達しました」誤爆が出ていた）。表示側（me-works-head等）と同じ
      // `poolCapacity ?? row.work_cap`に揃える。
      // **合同展示の部屋は専用プール**（migration 0061）なので、口座の共有プール
      // （`poolCapacity`）ではなくその部屋自身の`work_cap`だけで頭打ちにする。
      const cap = row.expo_id ? row.work_cap : (poolCapacity ?? row.work_cap)
      let room = Math.max(0, cap - works.length)
      let skipped = 0
      for (const f of Array.from(files)) {
        if (f.type.startsWith('video/')) {
          alert(t('me.videoFromRoom', { name: f.name }))
          continue
        }
        if (room <= 0) {
          skipped++
          continue
        }
        const title = f.name.replace(/\.[^.]+$/, '') || 'Untitled'
        // Straight from the original file — no data-URL round-trip to re-encode
        await uploadArtwork({ ownerId: user.id, file: f, title, galleryId: row.expo_id ? row.id : undefined })
        room--
      }
      if (skipped > 0) {
        // Hitting the cap is the moment the capacity add-on has real demand.
        track('me_work_limit_hit', { cap, skipped, attempted: files.length })
        alert(t('me.capReachedSkipped', { cap }))
      }
      track('me_work_upload_done', { count: files.length - skipped, bytes, ms: Date.now() - startedAt })
      await refreshWorks()
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      // Upload failure is the most damaging silent exit in the whole product.
      track('me_work_upload_error', { count: files.length, bytes, reason: msg })
      alert(t('me.uploadFailed', { msg }))
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
      await refreshWorks()
    } catch (e) {
      alert(t('me.workRemoveFailed', { msg: String(e instanceof Error ? e.message : e) }))
    }
  }

  // The work's plate text (title/caption/price/link/size/medium) autosaves after a
  // short pause — same "type and it saves" model as the exhibition title/statement,
  // so there's no Save button. The payload is captured at call time, so switching
  // works mid-debounce still commits the edit to the work it was made on.
  function editWork(next: Partial<{
    title: string; caption: string; purchaseLinks: PurchaseLink[]; price: string; width: string; height: string; medium: string
    cropAlign: CropAlign
  }>) {
    if (next.title !== undefined) setTitleInput(next.title)
    if (next.caption !== undefined) setCaptionInput(next.caption)
    if (next.purchaseLinks !== undefined) setPurchaseLinksInput(next.purchaseLinks)
    if (next.price !== undefined) setPriceInput(next.price)
    if (next.width !== undefined) setWidthInput(next.width)
    if (next.height !== undefined) setHeightInput(next.height)
    if (next.medium !== undefined) setMediumInput(next.medium)
    if (next.cropAlign !== undefined) setCropAlignInput(next.cropAlign)
    const id = selected?.id
    if (!id) return
    const w = parseFloat(next.width ?? widthInput)
    const h = parseFloat(next.height ?? heightInput)
    const payload = {
      title: next.title ?? titleInput,
      description: next.caption ?? captionInput,
      purchaseLinks: next.purchaseLinks ?? purchaseLinksInput,
      price: next.price ?? priceInput,
      widthCm: Number.isFinite(w) && w > 0 ? w : null,
      heightCm: Number.isFinite(h) && h > 0 ? h : null,
      medium: next.medium ?? mediumInput,
      cropAlign: next.cropAlign ?? cropAlignInput,
    }
    // **作品ごとに別枠**（`work:<id>`）。ひとつの枠にすると、2点続けて直したときに
    // 先の作品の変更が消える。
    mark('work', id, async () => {
      await updateArtworkDetails(id, payload)
      await refreshWorks()
    })
  }

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
        {/* 「保存中…」ではなく**未保存の目印**（2026-08-13 に自動保存をやめた）。
            どのカードに未保存が残っているかが分かる。保存は上帯のボタン。 */}
        {workPendingKey && (
          <span className="hako-save-state">{t('me.unsavedMark')}</span>
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
        {/* Free-form label + URL pairs (a shop, a wallpaper, an NFT…) rather than one
            fixed link — the artist decides what each offer is (ユーザー指示
            2026-08-12). Not a <label>: nesting the add/remove <button>s inside one
            would hijack its association away from the text inputs (see FieldLabel's
            comment on this same hazard above). */}
        <div className="me-field" style={{ margin: '0.45rem 0' }}>
          <FieldLabel hint={t('me.purchaseLinkHint')}>{t('me.purchaseLink')}</FieldLabel>
          <div className="sns-custom">
            {purchaseLinksInput.map((link, i) => (
              <div key={i} className="sns-custom-row">
                <input
                  type="text"
                  aria-label={t('me.purchaseLinkLabelPlaceholder')}
                  placeholder={t('me.purchaseLinkLabelPlaceholder')}
                  className="sns-custom-label"
                  value={link.label}
                  onChange={(e) =>
                    editWork({ purchaseLinks: purchaseLinksInput.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)) })
                  }
                />
                <input
                  type="text"
                  inputMode="url"
                  aria-label={t('me.purchaseLinkPlaceholder')}
                  placeholder={t('me.purchaseLinkPlaceholder')}
                  value={link.url}
                  onChange={(e) =>
                    editWork({ purchaseLinks: purchaseLinksInput.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)) })
                  }
                />
                <button
                  type="button"
                  className="sns-custom-del"
                  aria-label={t('me.purchaseLinkRemove')}
                  title={t('me.purchaseLinkRemove')}
                  onClick={() => editWork({ purchaseLinks: purchaseLinksInput.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn-line sns-add"
              onClick={() => editWork({ purchaseLinks: [...purchaseLinksInput, { label: '', url: '' }] })}
            >
              + {t('me.purchaseLinkAdd')}
            </button>
          </div>
        </div>
        <div className="wd-row" style={{ margin: '0.45rem 0' }}>
          <span className="wd-label">{t('me.size')}</span>
          <div className="design-controls wd-size" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
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
          // The crop happens on exactly one axis (Exhibit.tsx's UV offset), and
          // 'start'/'end' are UV-space positions (offset 0 / the far offset) —
          // axis-agnostic on purpose (see the comment there). Whether that reads
          // as Left/Right or Top/Bottom is decided here, from which axis is being
          // cropped: the U axis is unflipped (start=left), but the V axis is
          // flipped for texture upload, so a vertical crop's start=bottom.
          const vertical = imgA <= sizeA
          const alignOptions: { value: CropAlign; labelKey: string }[] = vertical
            ? [
                { value: 'end', labelKey: 'me.cropAlignTop' },
                { value: 'center', labelKey: 'me.cropAlignCenter' },
                { value: 'start', labelKey: 'me.cropAlignBottom' },
              ]
            : [
                { value: 'start', labelKey: 'me.cropAlignLeft' },
                { value: 'center', labelKey: 'me.cropAlignCenter' },
                { value: 'end', labelKey: 'me.cropAlignRight' },
              ]
          return (
            <div style={{ margin: '0.45rem 0' }}>
              <p className="me-note me-note--warn">{t('me.cropWarn', { pct: Math.round(crop * 100) })}</p>
              <div className="chips" role="group" aria-label={t('me.cropAlignLabel')}>
                {alignOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`chip${cropAlignInput === o.value ? ' active' : ''}`}
                    onClick={() => editWork({ cropAlign: o.value })}
                  >
                    {t(o.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          )
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
          const next = { ...overrides.lights }
          if (k) next[selected.id] = k
          else delete next[selected.id]
          editOverrides({ lights: next })
        }}
        onFrame={(k) => editOverrides({ frames: setOverride(overrides.frames, selected.id, k, view.frame_default) })}
        onMat={(k) => editOverrides({ mats: setOverride(overrides.mats, selected.id, k, view.mat_default) })}
        onHanging={(k) => editOverrides({ hangings: setOverride(overrides.hangings, selected.id, k, view.hanging_default) })}
        onCaption={(k) => editOverrides({ captions: setOverride(overrides.captions, selected.id, k, view.caption_default) })}
      />
    </div>
  ) : null

  // 部屋の切替タブ。**「部屋」「配置」ステージの中にだけ置く**（ユーザー指示
  // 2026-08-10）。以前は全ステージの上に一律で出していたが、部屋によって中身が
  // 変わるのはこの2ステージだけ（作品は口座全体の作品庫・公開は「いま開いている
  // 部屋」の話で、どちらも切替の意味が薄い）。ロジックは変えず、置き場所だけ動かした。
  //
  // **合同展示の部屋はここに並べない**（ユーザー指摘 2026-08-14）。一度は同じ列に混ぜて
  // 行き来させたが、**合同展示は「もう1つの部屋」ではなく別のモード**なので同列に並ぶと
  // 違和感が出る、という指摘で撤回した。通常展示⇄合同展示の切替は Hero 右上のボタン
  // （`RoomExpoBadge`）が担う。
  //
  // **合同展示の部屋を開いているあいだは丸ごと隠す**: 合同展示は1展示につき1部屋と
  // 決めてあるので（migration 0062）、そこに切替タブが並ぶ意味が無い。
  // ※これは 2026-08-13 に置いた条件と同じ。混ぜた期間（同日）の変更を戻したもの。
  const roomSwitcher = !row.expo_id && rooms && rooms.length > 1 && (
    <nav className="me-rooms" aria-label={t('me.roomsNav')}>
      {rooms.map((g) => {
        const label = isPlaceholderTitle(g.title) ? g.slug : g.title
        return (
          <button
            key={g.id}
            type="button"
            className={`me-room-tab${g.id === row.id ? ' active' : ''}`}
            aria-current={g.id === row.id ? 'page' : undefined}
            onClick={() => onSwitchRoom?.(g.id)}
          >
            {label}
            {g.id === frontDoorId && (
              <span className="me-room-main" title={t('me.frontDoor')}>{t('me.frontDoorShort')}</span>
            )}
          </button>
        )
      })}
    </nav>
  )

  return (
    <>
    {/* The stage bar is the only navigation (the header card and the top tabs are
        gone — ユーザー指示 2026-07-30). Profile leads (who you are), then the publish
        flow; the guestbook lives INSIDE the publish stage. (Per-stage "done" check
        marks were dropped — ユーザー指示 2026-07-31.) */}
    {/* タブの行と保存ボタンを1つの行にする（ユーザー指示 2026-08-13: 「PCの場合は、
        作品などの並びのタブの右端に保存ボタンを表示 / SPの場合は、画面下部に固定で表示」）。
        **要素は1つだけ置いて、電話では CSS で画面下へ固定する** ── 同じボタンを2つ置くと
        読み上げに2回出るし、片方だけ状態が古くなる余地が生まれる。 */}
    <div className="me-stages-row">
    <nav className="me-stages" aria-label={t('me.navSections')}>
      {(
        [
          ['profile', t('me.tabProfile'), null],
          // 作品 → 部屋 の順（ユーザー指示 2026-08-11で元に戻した。0809時点では
          // 「空間を決めてから中身を入れる」で部屋→作品にしていたが、ユーザーが
          // 使ってみて並びを戻したいと判断した）。
          ['works', t('me.stageWorks'), works.length || null],
          ['room', t('me.navRoom'), null],
          ['placement', t('me.placement'), null],
          // **合同展示の部屋の、主催者にだけ出す**（ユーザー指示 2026-08-10、
          // migration 0062 で主催者限定に訂正 ── 参加作家にも自分の部屋があるように
          // なったので、招待・会期の決済はその展示を開いた主催者だけの操作）。招待の
          // 管理は `ExpoManager` からここへ移した ── 通常展示と合同展示の部屋編集画面を
          // 「タブの数が違うだけ」の同じ形にする。
          row.expo_id && isOrganizer ? ['participants', t('me.stageParticipants'), null] : null,
          ['publish', t('me.stagePublish'), null],
        ].filter((x): x is [Stage, string, number | null] => x !== null)
      ).map(([key, label, count]) => (
        <button
          key={key}
          type="button"
          className={`me-stage${stage === key ? ' active' : ''}`}
          aria-current={stage === key ? 'page' : undefined}
          onClick={() => {
            track('me_stage_view', { stage: key, from: stage })
            setStage(key)
          }}
        >
          {label}
          {count != null && <span className="me-stage-count">{count}</span>}
        </button>
      ))}
    </nav>
    {/* 「変更があります」を**言葉で**出す（ユーザー指示 2026-08-13）。タブを移動しても
        内容は保たれる作りなので、金色のボタンだけでは「何か残っている」と気づけない。 */}
    {/* 保存の枠は**自分の部屋のときだけ**。主催者が参加作家の部屋を開いているときは
        DB側に書き込みのポリシーが1つも無いので（migration 0062・0064）、保存ボタンを
        出しても押せば必ず失敗する ── 押せるのに失敗するボタンは出さない。 */}
    {isMyRoom && (
      <div className="me-save-slot">
        {dirty && <span className="me-save-note">{t('me.unsavedNote')}</span>}
        <SaveAllButton />
      </div>
    )}
    </div>
    {/* 他人の部屋を見ていることを、編集面より先に言う（migration 0064・ユーザー選択C
        2026-08-14: 主催者は「準備できた」参加作家の部屋の中身を見られる）。
        **見た目が編集画面そのものなので、書けないことを言葉で出さないと、触ってから
        エラーで気づくことになる。** */}
    {!isMyRoom && (
      <p className="me-note me-readonly-note" role="status">
        {roomOwnerName ? t('me.readOnlyRoom', { name: roomOwnerName }) : t('me.readOnlyRoomAnon')}
      </p>
    )}
    {/* 部屋の切替タブ＋部屋の追加は「部屋」「配置」「公開」ステージの枠の外・タブの
        直下に出す（ユーザー指示 2026-08-11: 以前は箱の中にあった／公開タブにも
        出してほしいと追加指示）。追加ボタンも同じ3ステージすべてに出す（ユーザー指摘
        2026-08-12: 「部屋タブは配置・公開タブ配下にも設置して」— 以前は「部屋」
        ステージだけに限定されていた）。 */}
    {/* 部屋の切替タブ＋部屋の追加は「部屋」「配置」「公開」の3ステージだけに出す
        （ユーザー指示 2026-08-11、2026-08-14 に一度全ステージへ広げてから元に戻した）。
        部屋によって中身が変わるのはこの3つだけで、作品は口座全体の作品庫・プロフィールは
        人の話なので、そこに部屋の切替が並ぶ意味が無い。通常展示⇄合同展示の切替は
        ステージに関係なく Hero 右上のボタンから行える。 */}
    {(stage === 'room' || stage === 'placement' || stage === 'publish') && (roomSwitcher || roomAdd) && (
      <div className="me-rooms-row">
        {roomSwitcher}
        {roomAdd}
      </div>
    )}
    {/* One next step at a time toward publishing — not shown on the housekeeping stages */}
    {(() => {
      if (stage === 'profile') return null
      const hint = works.length === 0
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
        <>
        {/* The room's editing surface: sticky 3D preview on the left, its design on the right */}
        <div className="works-detail">
        <GalleryPreview
          art={roomArt}
          src={roomSrc}
          index={Math.max(0, works.indexOf(roomArt))}
          themeKey={view.theme}
          frameKey={view.frame_default}
          matKey={view.mat_default}
          hangingKey={view.hanging_default}
          captionKey={view.caption_default}
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
                      className={`chip chip-visual${key === view.theme ? ' active' : ''}${unlocked ? '' : ' locked'}`}
                      disabled={busy}
                      onClick={() => {
                        if (!unlocked) { setPurchaseItem({ kind: 'theme', key, label: def.label }); return }
                        setSpace({ theme: key, ...def.recommends, mat: 'auto' })
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
            {/* 間取り選択（＋カスタムサイズ）は配置ステージへ引っ越した（ユーザー指示
                2026-08-11: 「配置」の話なので「配置」タブの中で選びたい）。ハンドラは
                このGalleryCard内で共有のまま（`setSpace`/`editCustom`等）なので、
                描画位置を動かすだけでロジックは何も変えていない。 */}
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
                      value={design.wall ?? hex((THEMES[view.theme] ?? THEMES.chic).wall)}
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
                      value={design.floor ?? hex((THEMES[view.theme] ?? THEMES.chic).floorTint)}
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
                      value={design.lightColor ?? hex((THEMES[view.theme] ?? THEMES.chic).spotColor)}
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
        </>
      ) : stage === 'works' ? (
        /* The works library: grid + the shared editor sheet */
        <div className="works-detail">
          <GalleryPreview
            art={selected ? previewArt : roomArt}
            src={selected ? previewSrc : roomSrc}
            index={selected ? selectedIndex : Math.max(0, works.indexOf(roomArt))}
            themeKey={view.theme}
            frameKey={selected ? frame : view.frame_default}
            matKey={selected ? mat : view.mat_default}
            hangingKey={selected ? hanging : view.hanging_default}
            captionKey={selected ? captionKey : view.caption_default}
            designOverrides={selected ? selectedDesign : design}
            emptyNote={t('me.emptyRoomNote')}
            mode={selected ? 'work' : 'room'}
          />
          <div className="we-right">
            <div className="me-works-head">
              {/* count/capは口座全体の合計（migration 0052の「移動」は撤回。ユーザー指摘
                  2026-08-11: 部屋ごとの数字を分けて考えず「共通」で扱いたい）。部屋ごとの
                  `work_cap`は購入・等級の記帳として残るが、合計だけを見せる。 */}
              <span className="me-works-count">{t('me.navWorksCount', { count: works.length, cap: effectivePoolCapacity ?? row.work_cap })}</span>
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
            {/* The two ways to hang more work, side by side at the moment it matters.
                They are NOT interchangeable and the prices say so: filling this room to
                its physical max costs `PRICE_SLOT` × the slots left, while a whole extra
                room with all MAX_WORKS_PER_ROOM slots included costs PRICE_ROOM — which
                for a room at the free cap is the cheaper way to gain capacity.
                Showing only the slot offer here would let someone spend more than they
                had to and find out afterwards, so both are on screen together
                (ユーザー決定 2026-08-09). Only shown once this room is actually full:
                before that neither is a decision the owner needs to make.

                Gated on `poolCapacity !== null` — not `poolCapacity ?? row.work_cap`
                (ユーザー指摘 2026-08-11: 「この部屋はいっぱいです」が読み込み時に一瞬
                出る)。`allOwnedRooms`（口座全体の作品プールを合算する材料）は
                `works` と別のfetchで、後から届く。届く前に `row.work_cap`
                （この部屋"だけ"の枠、共通プール化以降は口座合計よりずっと小さいこと
                が多い）へフォールバックすると、口座全体では余裕があるのに一瞬だけ
                満室の文言が出る。真の合計が分かるまでは出さない。 */}
            {effectivePoolCapacity !== null && works.length >= effectivePoolCapacity && roomOffer && !row.expo_id && (
              <div className="me-capacity-offer">
                <p className="me-note" style={{ marginTop: 0 }}>{t('me.capacityChoice')}</p>
                <div className="me-capacity-choices">
                  {row.work_cap < MAX_WORKS_PER_ROOM && (
                    <button
                      type="button"
                      className="me-capacity-choice"
                      onClick={() => setPurchaseItem({ kind: 'capacity', key: 'capacity', label: t('me.addWorkSlots') })}
                    >
                      <strong>{t('me.capacityDenser')}</strong>
                      <span>
                        {t('me.capacityDenserDesc', {
                          price: PRICE_SLOT,
                          left: MAX_WORKS_PER_ROOM - row.work_cap,
                        })}
                      </span>
                    </button>
                  )}
                  <button type="button" className="me-capacity-choice" onClick={roomOffer}>
                    <strong>{t('me.capacityAnotherRoom')}</strong>
                    <span>{t('me.capacityAnotherRoomDesc', { price: PRICE_ROOM, slots: MAX_WORKS_PER_ROOM })}</span>
                  </button>
                </div>
              </div>
            )}
            {/* One row, scrolled sideways when it outgrows the width. "Add" sits at
                the HEAD of the row: at the tail it ends up past the right edge once
                there are a few works — the same trap the old rail fell into
                (ユーザー指摘 2026-07-28). */}
            <div className="me-works-row">
              {/* `isMyRoom`（別視点レビューで検出）: 主催者が参加作家の部屋を開いている
                  ときにここを出すと、**R2へのアップロードは通ってから** `artworks` の
                  insert が 0061 に拒否され、**誰も消せない孤児ファイルだけが残る**。
                  押せるのに必ず失敗する操作は出さない。 */}
              {isMyRoom && works.length < (effectivePoolCapacity ?? row.work_cap) && (
                <label className={`me-work-tile me-add-tile${uploading ? ' busy' : ''}`} aria-disabled={uploading}>
                  <span className="me-add-tile-plus" aria-hidden="true">{uploading ? '…' : '+'}</span>
                  <small>{uploading ? t('me.uploading') : works.length === 0 ? t('me.addFirstWork') : t('me.addWork')}</small>
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
              {works.map((art) => (
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
                  {/* 他人の部屋では出さない（別視点レビューで検出）。RLS が他人の作品の
                      削除を0行で弾くので、押しても何も起きないボタンになる。 */}
                  {isMyRoom && (
                    <button
                      type="button"
                      className="me-work-tile-del"
                      aria-label={t('me.workRemove')}
                      title={t('me.workRemove')}
                      onClick={() => void removeWork(art)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {/* Video is a paid axis and is uploaded from inside the 3D room, so here we
                only surface the offer — buy the pass, then add video from "Edit space"
                (ユーザー指示 2026-08-04: put a Video Pass entry in the works stage). */}
            {!entitlements.videoEnabled && (
              <div className="me-video-upsell">
                <p className="me-note">{t('me.videoUpsell')}</p>
                <button
                  type="button"
                  className="btn-line"
                  onClick={() => setPurchaseItem({ kind: 'video_pass', key: '', label: t('panel.videoPass') })}
                >
                  {t('panel.buyVideoPass', { price: PRICE_VIDEO_PASS })}
                </button>
              </div>
            )}
            {workSheet}
          </div>
        </div>
      ) : stage === 'placement' ? (
        /* Placement is a top-down room map (ユーザー指示 2026-07-31): drag a work from the
           tray onto a wall slot to hang it, drag a hung work onto another to swap them.
           editPlacement persists the arrangement + rebuilds the public room. */
        <>
        <div className="placement-stage">
          {/* 間取り選択（＋カスタムサイズ）は部屋ステージから引っ越した（ユーザー指示
              2026-08-11: 「間取り」は配置の話なので配置タブの中に置く）。作品0件でも
              間取りは決められるので、下の「作品を先に追加」の分岐より前に置く。 */}
          {/* 「間取り」と「配置」は同じ格の見出し（ユーザー指摘 2026-08-13
              「間取り / 配置 というそれぞれ見出し扱いのテキストがデザインの平仄が
              揃っていない」）。**片方が72px幅の脇ラベル（`.wd-label`）、もう片方が
              ブロック見出し（`.placement-title`）**だったので、大きさ・字送り・
              大文字化がすべて違っていた。両方ブロック見出しに揃え、字はトークン
              （`--label-size` / `--label-track`）で1つにする。 */}
          <div className="wd-group wd-group--flush">
            {/* **他のタブと同じ `.wd-title`**（ユーザー指摘 2026-08-13「他のタブ配下の
                見出しと見え方が違う」）。`.placement-title` は同じ字にしたつもりでも
                `<h3>` のままだったので**太字（UA既定の bold）**で、`<div>` で書かれている
                他タブの見出しより太く見えていた。`.wd-title` は `space-between` の行なので、
                「変更」はそのまま右端に来る。 */}
            <div className="wd-title place-layout-head">
              {/* 見出しの**中に**ボタンを入れない ── 読み上げは見出しの名前を中身から
                  作るので、「間取り 回廊 変更」と1つの見出しに聞こえてしまう。
                  行（`.wd-title`）を器にして、見出しとボタンを並べる。 */}
              <h3>{t('me.layout')}</h3>
              {/* 閉じているときは「いまの間取り」を図と名前で見せる ── 畳んだ結果
                  「何が選ばれているか分からない」になるのが一番まずい。 */}
              <button
                type="button"
                className="place-layout-toggle"
                aria-expanded={layoutOpen}
                aria-controls="place-layout-picker"
                onClick={() => setLayoutOpen((v) => !v)}
              >
                <LayoutPlan layoutKey={view.layout} params={view.layout_params} className="chip-plan" />
                <span className="place-layout-now">
                  {view.layout === 'custom' ? t('me.custom') : t(`presets.layout.${view.layout}`)}
                </span>
                <span className="place-layout-cta">{layoutOpen ? t('common.close') : t('common.change')}</span>
              </button>
            </div>
            {/* 開閉する範囲は**1つの入れ物**にまとめる ── `aria-controls` が指す範囲と、
                実際に開閉する範囲を一致させるため（別視点レビューで検出。カスタムの
                サイズ調整はこの中にある）。 */}
            <div id="place-layout-picker" hidden={!layoutOpen}>
            <div className="wd-row">
              <div className="chips">
                {unlockedFirst(Object.entries(LAYOUTS), ([key]) => isLayoutUnlocked(key, entitlements)).map(([key, def]) => {
                  const unlocked = isLayoutUnlocked(key, entitlements)
                  return (
                    <button
                      key={key}
                      className={`chip chip-visual${key === view.layout ? ' active' : ''}${unlocked ? '' : ' locked'}`}
                      disabled={busy}
                      onClick={() => {
                        if (!unlocked) { setPurchaseItem({ kind: 'layout', key, label: t(`presets.layout.${key}`) }); return }
                        setSpace({ layout: key })
                        // **カスタムだけは畳まない** ── サイズ調整（幅・奥行き・中央壁）が
                        // この中にあるので、選んだ瞬間に閉じると届かなくなる
                        // （別視点レビューで検出）。他の間取りは選んで終わりなので畳む。
                        if (key !== 'custom') setLayoutOpen(false)
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
                {(CUSTOM_LAYOUT_RELEASED || view.layout === 'custom') && (() => {
                  const unlocked = view.layout === 'custom' || isLayoutUnlocked('custom', entitlements)
                  return (
                    <button
                      className={`chip chip-visual${view.layout === 'custom' ? ' active' : ''}${unlocked ? '' : ' locked'}`}
                      disabled={busy}
                      onClick={() => {
                        if (!unlocked) { setPurchaseItem({ kind: 'layout', key: 'custom', label: t('me.custom') }); return }
                        setSpace({ layout: 'custom' })
                        // カスタムは選んだあとサイズを決める。開いたままにする（上と同じ理由）
                      }}
                    >
                      <LayoutPlan layoutKey="custom" params={view.layout_params} className="chip-plan" />
                      {t('me.custom')}
                      {!unlocked && <span className="chip-price-tag chip-lock-only" aria-hidden="true"><LockIcon /></span>}
                    </button>
                  )
                })()}
              </div>
            </div>
            {view.layout === 'custom' && (
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
            </div>
          </div>
          {works.length > 0 ? (
            <>
              {/* 2つ目の節なので、他のタブの2つ目以降と同じ `.wd-group`（上に罫が入る）。
                  見出しも同じ `.wd-title`。 */}
              <div className="wd-group">
                <div className="wd-title"><h3>{t('me.placement')}</h3></div>
                <p className="me-note" style={{ marginTop: '-0.2rem' }}>{t('me.placementDragHint')}</p>
              </div>
              <PlacementEditor
                layoutKey={view.layout}
                layoutParams={normalizeLayoutParams(view.layout_params)}
                // 部屋ごとに固定ではなく、口座全体の枠を自由配分する（ユーザー決定
                // 2026-08-12: 「合計20枠あるのに、デフォルトの部屋では5枠しか置けない」
                // という指摘に対し、部屋ごとの固定割りを撤廃。この部屋が使える枠は
                // 「口座の合計 − 他の部屋に今置かれている点数」— 他の部屋を空ければ
                // この部屋はその分まで増やせる。`row.work_cap`はpoolCapacity未取得時
                // （＝旧来の1部屋だけの口座）のフォールバックとして残す。
                // **合同展示の部屋は専用プール**（migration 0061）なので、口座の共有
                // プールとは無関係にその部屋自身の`work_cap`だけで完結させる
                // （`effectivePoolCapacity`/`effectivePlacedElsewhere*` が差し替える）。
                workCap={
                  effectivePoolCapacity != null
                    ? Math.max(0, effectivePoolCapacity - effectivePlacedElsewhereCount)
                    : row.work_cap
                }
                poolTotal={effectivePoolCapacity ?? row.work_cap}
                works={works}
                guests={guests}
                arrangement={placement}
                onChange={editPlacement}
                placedElsewhere={effectivePlacedElsewhere}
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
        </>
      ) : stage === 'participants' && row.expo_id && isOrganizer ? (
        /* 合同展示の部屋の、主催者だけに出るタブ（ユーザー指示 2026-08-10）。中身は
           `ExpoManager` の各展示カードにあった参加者パネルそのもの ── 招く・承認する・
           招待リンクを配る、のすべてがここに移った。`onOpenRoom` で各参加者の
           自動生成の部屋も直接開ける（migration 0062）。 */
        <ParticipantsPanel expoId={row.expo_id} onChanged={onChanged} onOpenRoom={onOpenRoom} />
      ) : (
        /* Publish: everything about going public in one place — the URL name gate,
           the statement, the share cover, the switch, and the numbers */
        <div className="works-detail">
          <GalleryPreview
            art={roomArt}
            src={roomSrc}
            index={Math.max(0, works.indexOf(roomArt))}
            themeKey={view.theme}
            frameKey={view.frame_default}
            matKey={view.mat_default}
            hangingKey={view.hanging_default}
            captionKey={view.caption_default}
            designOverrides={design}
            emptyNote={t('me.emptyRoomNote')}
            mode="room"
          />
          <div className="we-right">
            {/* 合同展示の部屋: 見える/見えないは会期そのものが決める（0045。この部屋の
                `is_public` は常にfalseに固定されているのでトグルの出しようがない）。
                「会期を選んで公開＝支払い」も、旧 `ExpoManager` の中身をそのままここへ
                移した（ユーザー指示 2026-08-10: 通常展示と同じ『公開』タブの中で扱う）。 */}
            {row.expo_id ? (() => {
              // 'running'/'ended' だけが本当に開いている（0051: 'scheduled' はまだ
              // 始まっていない予約状態なので、下書きと同じくリンクにしない）。
              const isLive = !!expo && (expoPhase(expo) === 'running' || expoPhase(expo) === 'ended')
              return (
              <>
                <div className="hako-url-row">
                  <div className="hako-url-line">
                    {isLive ? (
                      <a
                        className="hako-url"
                        href={`${origin}${expoPath(expo!.slug)}/${row.slug}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {/* i18n-ok: URLの見本（ドメイン名は訳す対象ではない） */}
                        {`xibit360.art${expoPath(expo!.slug)}/${row.slug}`}
                      </a>
                    ) : (
                      <span className="hako-url off">
                        {/* i18n-ok: URLの見本（ドメイン名は訳す対象ではない） */}
                        {`xibit360.art${expo ? expoPath(expo.slug) : ''}/${row.slug}`}
                      </span>
                    )}
                  </div>
                  <div className="hako-state-line">
                    <span className={`hako-state${isLive ? ' open' : ''}`}>
                      {!expo
                        ? t('me.loading')
                        : expoPhase(expo) === 'draft'
                          ? t('expo.phaseDraft')
                          : expoPhase(expo) === 'scheduled'
                            ? t('expo.phaseScheduled', { on: fmtDate(expo.startsAt) })
                            : expoPhase(expo) === 'running'
                              ? t('expo.phaseRunning', { until: fmtDate(expo.endsAt) })
                              : t('expo.phaseEnded', { on: fmtDate(expo.endsAt) })}
                    </span>
                  </div>
                </div>
                {/* 会期を選んで公開＝決済は主催者だけの操作（migration 0062・ユーザー決定
                    2026-08-13）。参加作家の部屋は主催者の決済に相乗りしているので、
                    ここで別に何かを選ぶ必要が無い ── 代わりに下の「準備できた」を出す。 */}
                {isOrganizer && expo && expoPhase(expo) === 'draft' && (
                  <div className="expo-pay">
                    {/* 開始日時を入れたら「支払った瞬間に公開」ではなくなる。状態を
                        決めている `scheduleInput` から文を導出する（AGENTS.md 5.3）—
                        直下の入力欄に日時が入っているのに「すぐ公開」と書いてあるのは
                        購入前の説明として嘘になる。猶予での削除も購入前に開示する。 */}
                    <p className="me-note" style={{ marginTop: 0 }}>
                      {scheduleInput ? t('expo.payNoteScheduled') : t('expo.payNote')}{' '}
                      {t('expo.payNoteRun', { grace: EXPO_GRACE_DAYS })}
                    </p>
                    <label className="me-field">
                      <span>{t('expo.scheduleLabel')}</span>
                      <input
                        type="datetime-local"
                        value={scheduleInput}
                        min={nowForDatetimeLocal()}
                        onChange={(e) => setScheduleInput(e.target.value)}
                      />
                      <small className="me-field-hint">
                        {t('expo.scheduleTzHint', { tz: localTimeZoneLabel() })}
                      </small>
                    </label>
                    <div className="hako-actions">
                      {expoRunOptions().map((o) => (
                        <button
                          key={o.sku}
                          type="button"
                          className="btn-line btn-gold"
                          disabled={busy}
                          onClick={() =>
                            void run(t('expo.openIt'), async () => {
                              track('expo_checkout', { expo: expo.slug, days: o.days, scheduled: !!scheduleInput })
                              await updateExpo(expo.id, { durationDays: o.days })
                              const startsAt = scheduleInput ? new Date(scheduleInput).toISOString() : undefined
                              window.location.href = await startExpoCheckout(expo.id, o.sku, startsAt)
                            })
                          }
                        >
                          {t('expo.payOption', { days: o.days, price: usd(o.cents) })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* 参加作家（主催者ではない）の「公開」タブの中身: 決済ではなく
                    「準備できた」トグル（migration 0062）。オンにすると主催者に通知が
                    届く。会期の状態に関わらずいつでも出す ── 下書きのうちに準備を
                    終えておける方が、開幕ぎりぎりより自然。 */}
                {!isOrganizer && (
                  <div className="expo-pay">
                    <p className="me-note" style={{ marginTop: 0 }}>{t('invite.readyToggleHint')}</p>
                    <div className="hako-state-line">
                      <label className="switch" title={row.expo_ready_at ? t('invite.readyOn') : t('invite.readyOff')}>
                        <input
                          type="checkbox"
                          checked={!!row.expo_ready_at}
                          disabled={busy}
                          onChange={() => void toggleReady()}
                        />
                        <span className="knob" aria-hidden="true" />
                      </label>
                      <span className={`hako-state${row.expo_ready_at ? ' open' : ''}`}>
                        {row.expo_ready_at ? t('invite.readyOn') : t('invite.readyOff')}
                      </span>
                    </div>
                    {row.expo_ready_at && (
                      <p className="me-note">{t('invite.readyMarkedAt', { date: fmtDate(row.expo_ready_at) })}</p>
                    )}
                    {/* この展示から降りる（ユーザー指示 2026-08-14）。受信箱にあったものを
                        ここへ移した ── 受信箱は画面の一番上、部屋の編集画面はその下という
                        離れた場所にあり、**同じ展示の話が2か所に分かれていた**。降りるのは
                        「この部屋をやめる」なので、部屋の中にあるのが自然。
                        押すと 0062 のトリガがこの部屋も片付ける（作品は共有プールへ戻る）。 */}
                    {/* **降りるボタンだけ `expo` の到着を待つ**（別視点レビューで2回検出）。
                        `isOrganizer` は読み込み中「主催者ではない」に倒しているので、
                        待たないと**主催者が自分の展示の部屋でこれを押せる** ── `leaveExpo`
                        は該当行が無く0行更新で静かに戻り、何も起きないのに「保存しました」
                        だけが出る。**上のトグルまで一緒に待たせてはいけない** ──
                        `getExpoById` が失敗すると `expo` は null のまま再取得されないので、
                        参加作家がトグルにも降り口にも辿り着けなくなる（受信箱から導線を
                        外した今、ここが唯一の降り口）。 */}
                    {expo && (
                      <div className="hako-actions" style={{ marginTop: '0.9rem' }}>
                        <button
                          type="button"
                          className="btn-line"
                          disabled={busy}
                          onClick={() => {
                            if (!confirm(t('invite.leaveConfirm'))) return
                            void run(t('invite.leave'), () => leaveExpo(row.expo_id!, user.id))
                          }}
                        >
                          {t('invite.leave')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {expo && expoPhase(expo) === 'ended' && expoPurgeAt(expo) && (
                  <p className="me-note expo-warn">{t('expo.purgeNote', { on: fmtDate(expoPurgeAt(expo)!.toISOString()) })}</p>
                )}
              </>
              )
            })() : /* The URL and its state live together: flip the switch to open / close the room */
            username ? (
              /* Two lines so the toggle never wraps away from its label (ユーザー指示
                 2026-07-31): the URL + copy on top, the open/close switch + state below. */
              <div className="hako-url-row">
                <div className="hako-url-line">
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
                </div>
                <div className="hako-state-line">
                  <label
                    className="switch"
                    title={
                      row.is_public
                        ? t('me.openHint')
                        : works.length
                          ? t('me.privateHint')
                          : t('me.needWorkHint')
                    }
                  >
                    <input type="checkbox" checked={row.is_public} disabled={busy} onChange={() => void togglePublic()} />
                    <span className="knob" aria-hidden="true" />
                  </label>
                  <span className={`hako-state${row.is_public ? ' open' : ''}`}>{row.is_public ? t('me.open') : t('me.private')}</span>
                </div>
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
            {/* Multi-room only: which room `/@name` opens on, and the path segment the
                other rooms sit at. With one room there is no front door to choose and no
                second URL to name, so none of this appears (ユーザー決定 2026-08-09). */}
            {!row.expo_id && roomCount > 1 && username && (
              <div className="me-room-url">
                {isMain ? (
                  <p className="me-note" style={{ marginTop: 0 }}>{t('me.frontDoorThis')}</p>
                ) : (
                  <>
                    <div className="field-row">
                      <FieldLabel hint={t('me.roomSlugHint')}>{t('me.roomSlug')}</FieldLabel>
                    </div>
                    <div className="field-row">
                      <input
                        type="text"
                        aria-label={t('me.roomSlug')}
                        value={slugInput}
                        spellCheck={false}
                        onChange={(e) => setSlugInput(e.target.value)}
                      />
                      <button
                        className="btn-line"
                        disabled={busy || !slugInput.trim() || slugInput.trim().toLowerCase() === row.slug}
                        onClick={() => void saveSlug()}
                      >
                        {t('me.roomSlugSave')}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn-line"
                      disabled={busy}
                      onClick={() => void makeFrontDoor()}
                    >
                      {t('me.frontDoorMake')}
                    </button>
                  </>
                )}
              </div>
            )}
            {/* Actions for the finished room: walk it in 3D (always — the room can be
                arranged before it's public), plus embed + catalog once it's live
                (ユーザー指示 2026-07-30 — "部屋を歩く" moved here from the header). */}
            <div className="hako-url-actions">
              {/* `/demo` renders the STORE's settings, and the store only ever loads the
                  front-door room — from a sub-room's tab it would walk the wrong room.
                  A sub-room is walked at its real URL instead, which works before it is
                  public too (the owner-preview path in app/[handle]/[slug]). 合同展示の
                  部屋は会期が生きているあいだだけ本物のURLがある（0045。下書き中は
                  どこにも通じないので出さない）。 */}
              {row.expo_id ? (
                expo && (expoPhase(expo) === 'running' || expoPhase(expo) === 'ended') && (
                  <a className="btn-line" href={`${expoPath(expo.slug)}/${row.slug}`} target="_blank" rel="noreferrer">
                    {t('me.navWalk')}
                  </a>
                )
              ) : isMain || !username ? (
                <LocaleLink className="btn-line" href="/demo">{t('me.navWalk')}</LocaleLink>
              ) : (
                <a className="btn-line" href={`/@${username}/${row.slug}`} target="_blank" rel="noreferrer">
                  {t('me.navWalk')}
                </a>
              )}
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
                {detailsPending && (
                  <span className="hako-save-state">{t('me.unsavedMark')}</span>
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
              {/* 文字数制限なし（ユーザー指示 2026-08-13）。上と同じ理由。 */}
              <textarea
                className="hako-statement-input"
                rows={2}
                placeholder={t('me.statementBoardPlaceholder')}
                aria-label={t('me.exhibitionStatement')}
                value={statementInput}
                onChange={(e) => editDetails({ statement: e.target.value })}
              />
              <small className="me-field-hint">{t('me.markdownOk')}</small>
              <MarkdownPreview value={statementInput} />
            </div>
            {works.length > 0 && (
              <div className="wd-group">
                <div className="wd-title"><span>{t('me.coverPick')}</span></div>
                <div className="me-cover-row">
                  {works.map((art) => (
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
              <div className="stat"><b>{works.length}</b><span>{t('me.statWorks')}</span></div>
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
            {/* 他人の部屋では出さない（別視点レビューで検出）。**これが一番たちが悪い**
                ── RLS は削除を0行で弾くが例外は投げないので、`run()` は成功したことに
                して「保存しました」を出す。主催者は**他人の部屋を消したと思い込む**。 */}
            {isMyRoom && (
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
            )}
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
            purchaseItem.kind === 'capacity' || purchaseItem.kind === 'video_pass'
              ? undefined
              : { kind: purchaseItem.kind, itemKey: purchaseItem.key }
          }
          flat={purchaseItem.kind === 'video_pass' ? { cents: PRICE_USD_CENTS.video_pass, kind: 'video' } : undefined}
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
            itemKey: purchaseItem.kind === 'capacity' || purchaseItem.kind === 'video_pass' ? '' : purchaseItem.key,
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
  // Marketing opt-in lives in Supabase user_metadata (not the app's slim AuthUser),
  // so read it straight from the auth user. null = still loading.
  const [marketing, setMarketing] = useState<boolean | null>(null)
  // Separate in-flight flag so a rapid on/off can't fire overlapping updateUser
  // calls whose responses resolve out of order and leave the saved consent
  // disagreeing with the UI (consent accuracy matters for compliance).
  const [savingMarketing, setSavingMarketing] = useState(false)

  useEffect(() => {
    let active = true
    void supabase!.auth.getUser().then(({ data }) => {
      if (active) setMarketing(Boolean(data.user?.user_metadata?.marketing_opt_in))
    })
    return () => {
      active = false
    }
  }, [])

  async function toggleMarketing(next: boolean) {
    setMarketing(next)
    setSavingMarketing(true)
    const { error } = await supabase!.auth.updateUser({
      data: { marketing_opt_in: next, ...(next ? { marketing_opt_in_at: new Date().toISOString() } : {}) },
    })
    setSavingMarketing(false)
    if (error) setMarketing(!next) // revert on failure
  }

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
      <label
        className="me-field"
        style={{ flexDirection: 'row', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}
      >
        <input
          type="checkbox"
          checked={marketing ?? false}
          disabled={marketing === null || busy || savingMarketing}
          onChange={(e) => void toggleMarketing(e.target.checked)}
        />
        <span style={{ margin: 0 }}>{t('auth.marketingOptIn')}</span>
      </label>
      <div className="hako-actions">
        <Link className="btn-line" href="/reset">{t('me.accountPassword')}</Link>
        <button className="btn-line hako-danger" disabled={busy} onClick={() => void removeAccount()}>
          {t('me.accountDelete')}
        </button>
      </div>
    </div>
  )
}

/** 入力欄の下に出す**マークダウンのプレビュー**（ユーザー質問 2026-08-13「フォーム内でも
 *  マークダウンって反映できますか？」）。`<textarea>` は仕組み上ただの文字しか描けないので、
 *  **入力欄の中で太字にすることはできない** ── 代わりに、書いたものが公開面でどう出るかを
 *  すぐ下に見せる（管理者の記事エディタと同じ作り）。
 *
 *  **記法を使っていないときは何も出さない。** 入力欄と同じものが2つ並ぶだけで、
 *  ダッシュボードが縦に伸びる分だけ損になる（判定は `hasMarkdown`）。
 *  描画の指定は公開面と同じ `ARTIST_TEXT_MD` を使う ── ここだけ違うと
 *  「プレビューでは改行されたのに公開面では潰れる」が起きる。 */
function MarkdownPreview({ value }: { value: string }) {
  const t = useT()
  // **打鍵を止めない**（別視点レビューで検出）。この欄は文字数制限を外したので、
  // 長文を貼られると「1文字打つ → 全文を12回の正規表現で走査 → 全文を解析 → 差分」が
  // 同じ同期レンダリングに乗る。`useDeferredValue` で低い優先度に落とすと、
  // 入力欄の反応が先に返り、プレビューは一拍遅れて追いつく。
  const shown = useDeferredValue(value)
  if (!hasMarkdown(shown)) return null
  return (
    <div className="me-md-preview">
      <p className="me-md-preview-label">{t('me.mdPreview')}</p>
      <div className="panel-md">{renderMarkdown(shown, ARTIST_TEXT_MD)}</div>
    </div>
  )
}

/**
 * ダッシュボードから**出ていく**リンクの門番。未保存があるときだけ確認する。
 *
 * `beforeunload` はブラウザを閉じる/リロードするときしか鳴らず、**アプリ内の遷移
 * （ロゴ・探す・管理）では鳴らない** ── そこを素通しにすると、長い展示情報を書いた直後に
 * ロゴを押しただけで消える。ユーザーの決定（2026-08-13）は「タブの移動では保持、離れる
 * ときだけ確認」なので、**ページから出る操作はここで聞く**。
 */
function useLeaveGuard() {
  const t = useT()
  const dirty = useHasPending()
  return (e: { preventDefault: () => void }) => {
    if (!dirty) return
    if (!window.confirm(t('me.unsavedLeave'))) e.preventDefault()
  }
}

/**
 * 上帯の**保存ボタン**（ユーザー指示 2026-08-13「オートセーブはやめて全てのタブ内の情報を、
 * 1ボタンで保存できるようにしよう」）。
 *
 * **`TopActions` の `before` に置く＝ハンバーガーに畳まれない場所。** 640px以下ではメニューの
 * 中身が畳まれるので、そこに入れると**未保存の目印がメニューを開くまで見えない**
 * （通知ベルで同じ失敗を一度している。LESSONS 2026-08-09）。
 *
 * 未保存が無いときも**出したままにする**（押せない状態で）── 現れたり消えたりするボタンは、
 * 押そうとした瞬間に位置が変わる。
 */
function SaveAllButton() {
  const t = useT()
  const dirty = useHasPending()
  const saving = usePending((s) => s.saving)
  const savedAt = usePending((s) => s.savedAt)
  const saveAll = usePending((s) => s.saveAll)
  const toast = useToast()
  // 「保存しました」は数秒だけ出す。ずっと出しているとボタンの意味が読めなくなる。
  const [justSaved, setJustSaved] = useState(false)
  useEffect(() => {
    if (!savedAt) return
    setJustSaved(true)
    const id = setTimeout(() => setJustSaved(false), 2600)
    return () => clearTimeout(id)
  }, [savedAt])

  const label = saving ? t('common.saving') : justSaved && !dirty ? t('common.saved') : t('me.saveAll')
  return (
    <button
      type="button"
      className={`me-save-all${dirty ? ' is-dirty' : ''}`}
      disabled={!dirty || saving}
      aria-label={dirty ? `${t('me.saveAll')}（${t('me.unsavedMark')}）` : t('me.saveAll')}
      onClick={() => {
        void (async () => {
          const r = await saveAll()
          if (r.ok) toast()
          else alert(t('me.saveAllFailed', { msg: r.failed ?? '' }))
        })()
      }}
    >
      {label}
      {dirty && <span className="me-save-dot" aria-hidden="true" />}
    </button>
  )
}

function ProfileCard() {
  const t = useT()
  const mark = usePending((s) => s.mark)
  const profilePending = usePendingKind('profile')
  const user = useGallery((s) => s.user)!
  const username = useGallery((s) => s.profileUsername)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const toast = useToast()
  const [nameInput, setNameInput] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  // 来歴（展示歴・受賞歴）。自己紹介とは別欄で、3Dの情報パネルでは別タブに出る（migration 0060）
  const [cv, setCv] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // Known-platform links keyed by id, plus free-form "other" links
  const [snsLinks, setSnsLinks] = useState<Record<string, string>>({})
  const [snsCustom, setSnsCustom] = useState<CustomLink[]>([])
  // What is literally in each SNS field while it is being edited. The stored value
  // is a handle (or a URL — lib/sns), and the field shows the whole URL, so typing
  // has to survive normalisation: keep the raw text here and fall back to the
  // canonical URL once the row is left alone. A row whose paste belongs to another
  // platform stays here and is NOT saved (ユーザー判断 2026-08-03: 注意文だけ出す).
  const [snsDraft, setSnsDraft] = useState<Record<string, string>>({})
  // 注意文は「その欄から離れたとき」だけ出す。打っている途中の `https://ins` は
  // まだどのホストにも当たらないので、live に出すと入力中ずっと赤くなる。
  const [snsFocus, setSnsFocus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Profile text (display name / bio / SNS) autosaves like everything else.

  useEffect(() => {
    let alive = true
    getProfile(user.id)
      .then((p) => {
        if (!alive) return
        setDisplayName(p.displayName)
        setBio(p.bio)
        setCv(p.cv)
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
    displayName: string; bio: string; cv: string; links: Record<string, string>; custom: CustomLink[]
  }>) {
    if (next.displayName !== undefined) setDisplayName(next.displayName)
    if (next.bio !== undefined) setBio(next.bio)
    if (next.cv !== undefined) setCv(next.cv)
    if (next.links !== undefined) setSnsLinks(next.links)
    if (next.custom !== undefined) setSnsCustom(next.custom)
    const payload = {
      displayName: next.displayName ?? displayName,
      bio: next.bio ?? bio,
      cv: next.cv ?? cv,
      sns: { links: next.links ?? snsLinks, custom: next.custom ?? snsCustom },
    }
    mark('profile', null, async () => {
      await saveProfile(user.id, payload)
      await refreshCloud()
    })
  }
  return (
    <>
    {/* No "プロフィール" heading here — the stage tab directly above already reads
        "プロフィール" and is highlighted active, so a repeat heading was pure noise
        (ユーザー指示 2026-08-11). 未保存の目印だけがここに座る。 */}
    {profilePending && (
      <div className="me-section-head">
        <span className="hako-save-state">{t('me.unsavedMark')}</span>
      </div>
    )}
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
        <small className="me-field-hint">{t('me.markdownOk')}</small>
      </label>
      <MarkdownPreview value={bio} />
      {/* 来歴（ユーザー要望 2026-08-13）。自己紹介と別の列（migration 0060）で、
          3Dの情報パネルでは「来歴」タブとして出る。空なら来場者にはタブが出ない。 */}
      <label className="me-field">
        <span>{t('me.profileCv')}</span>
        <textarea
          rows={5}
          value={cv}
          onChange={(e) => editProfile({ cv: e.target.value })}
        />
        <small className="me-field-hint">
          {t('me.profileCvNote')}
          <br />
          {t('me.markdownOk')}
        </small>
      </label>
      <MarkdownPreview value={cv} />
      <p className="me-field-group-label">
        {t('me.profileSnsNote')}
      </p>
      {/* One row per known platform with its official brand mark; leave any blank
          to hide it. "Other" links are added freely below (ユーザー指示 2026-07-30). */}
      <div className="sns-fields">
        {SNS_PLATFORMS.map((p) => {
          const Icon = BRAND_ICONS[p.id] ?? GlobeIcon
          // 欄に出すのは「来場者が開くURL」そのもの。編集中は打った文字を素で見せる
          const shown = snsDraft[p.id] ?? snsDisplayValue(p.id, snsLinks[p.id] ?? '')
          const mismatch = snsMismatch(p.id, shown)
          const wrong = snsFocus === p.id ? null : mismatch
          return (
            <div key={p.id} className="sns-field-wrap">
              <label className="sns-field">
                <span className="sns-field-icon" aria-hidden="true"><Icon /></span>
                <input
                  type="text"
                  inputMode="url"
                  aria-label={p.label}
                  aria-invalid={wrong ? true : undefined}
                  className={wrong ? 'is-wrong' : undefined}
                  // i18n-ok: 貼り付けるURLの見本（lib/sns の sample）
                  placeholder={p.sample}
                  value={shown}
                  onFocus={() => setSnsFocus(p.id)}
                  onChange={(e) => {
                    const raw = e.target.value
                    setSnsDraft((d) => ({ ...d, [p.id]: raw }))
                    // 保存するのは**正規化した値**（`@yusuke` → `yusuke`、末尾の / を落とす）。
                    // 欄の表示は打った文字のまま（draft）なので、打ちながら書き換えられて
                    // 邪魔になることはない。取り違えている間は**空を保存する** — 手で打つと
                    // `h` `ht` `htt` … は URL に見えないので通ってしまい、途中の断片が
                    // 保存値として残る。
                    const value = snsMismatch(p.id, raw) ? '' : normalizeSnsValue(p.id, raw)
                    editProfile({ links: { ...snsLinks, [p.id]: value } })
                  }}
                  onBlur={() => {
                    setSnsFocus(null)
                    // 正しい値に落ち着いたら、欄の表示を正規化したURLへ揃える
                    if (mismatch) return
                    setSnsDraft((d) => {
                      const { [p.id]: _drop, ...rest } = d
                      return rest
                    })
                  }}
                />
              </label>
              {wrong && (
                <p className="sns-field-warn" role="status">
                  {wrong.found
                    ? t('me.snsWrongPlatform', { found: wrong.found.label, expected: p.label })
                    : t('me.snsNotPlatform', { expected: p.label })}
                </p>
              )}
            </div>
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
// 合同展示は部屋とは別の実体（migration 0044）だが、**タブではなくモーダル**で開く
// （ユーザー指示 2026-08-10: 「合同展示」押下後の1ウインドウで一覧・作成・部屋を開く
// 操作を完結させる。以前はタブ遷移＋モーダルの2段階だった）。開閉は`expoManagerOpen`。
type MeTab = 'gallery' | 'account'

export default function MePage() {
  const t = useT()
  // 未保存があるか（保存ボタンと、閉じるときの確認に使う）
  const dirty = useHasPending()
  const guardLeave = useLeaveGuard()
  const user = useGallery((s) => s.user)
  const initAuth = useGallery((s) => s.initAuth)
  const hydrate = useGallery((s) => s.hydrate)
  const signOut = useGallery((s) => s.signOut)

  // 未保存のままブラウザを閉じる/リロードしようとしたときだけ確認を出す
  // （ユーザー選択 2026-08-13・A案。タブの移動では内容を保持するので邪魔しない）。
  // 文言はブラウザが決めるので `preventDefault` だけで足りる。**早期 return より前に
  // 置くこと** ── フックを条件の後ろに置くと React の規則を破る。
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '' // 古いブラウザはこちらを見る
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const isAdmin = useIsAdmin(user?.id ?? null)
  const [tab, setTab] = useState<MeTab>('gallery')
  // GalleryCardの中ではなくここに持つ（ユーザー指摘 2026-08-11: 部屋を切り替えると
  // 「作品」タブに戻ってしまう）。`GalleryCard`は`key={current.id}`で部屋ごとに
  // 再マウントされるので、ここに置かないと切替のたびに初期値'works'に戻る。
  // **リロードしても選んでいたタブに戻す**（ユーザー指示 2026-08-13: 「リロードしたときに
  // 毎回作品タブになるんですが、これは選択されているタブにして欲しい」）。
  // 初期値は `'works'` のままにして、**復元は mount 後の effect で行う** ── 初期値で
  // `localStorage` を読むと、サーバが描いた HTML と食い違って hydration が壊れる。
  const [stage, setStage] = useState<Stage>('works')
  /** 復元が済んだか。**済むまで書き込まない** ── mount 時は「復元 → 保存」の順に effect が
   *  走るので、保存側が初期値 `'works'` を書いてから復元が反映される。その一瞬に
   *  タブを閉じられると、選んでいたタブが `'works'` に潰れる（別視点レビューで検出）。 */
  const stageRestored = useRef(false)
  useEffect(() => {
    const saved = localStorage.getItem(STAGE_KEY)
    if (saved && (STAGES as readonly string[]).includes(saved)) setStage(saved as Stage)
    stageRestored.current = true
  }, [])
  useEffect(() => {
    if (!stageRestored.current) return
    localStorage.setItem(STAGE_KEY, stage)
  }, [stage])
  const [checked, setChecked] = useState(false)
  // null = still loading (prevents flashing the create card at returning users)
  const [galleries, setGalleries] = useState<GalleryRow[] | null>(null)
  /** `galleries` が誰の一覧か。**`user` と一致するまで、部屋数を根拠に何も決めない。** */
  const [galleriesFor, setGalleriesFor] = useState<string | null>(null)
  // 口座内の全部屋（合同展示の部屋も含む）。作品スロットの合計を出すためだけに持つ
  // ── `galleries`（`listMyGalleries`）は合同展示の部屋を落とすので、これは別に引く。
  const [allOwnedRooms, setAllOwnedRooms] = useState<GalleryRow[] | null>(null)
  // Which room the stage bar below is editing. null = the front-door room (resolved
  // after load, so it survives a room being deleted or bought while this is open).
  const [roomId, setRoomId] = useState<string | null>(null)
  // Open the "buy another room" modal — handed to every room through RoomOfferContext.
  const [roomOfferOpen, setRoomOfferOpen] = useState(false)
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [usage, setUsage] = useState<number | null>(null)
  // Set when Stripe Checkout sent the user back here (?purchase=success|cancelled)
  const [purchaseReturn, setPurchaseReturn] = useState<'success' | 'cancelled' | null>(null)
  // Help/FAQ opened in place, so building a room isn't interrupted (DECISIONS 2026-08-03)
  const [helpOpen, setHelpOpen] = useState(false)
  // 合同展示の管理モーダル（一覧・新規作成・部屋を開く、をこの1つで完結させる）。
  const [expoManagerOpen, setExpoManagerOpen] = useState(false)
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
      // Closes the funnel opened by checkout_modal_open → checkout_redirect.
      // `purchases` only ever records the successes; this also sees the give-ups.
      track('checkout_return', { result: purchase })
      window.history.replaceState(null, '', '/me')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 何回目の読み込みか。**遅れて返った古い応答で新しい状態を上書きしない**
   *  （5巡目の別視点レビューで検出）。同じタブでアカウントが差し替わると読み込みが
   *  2本走り、前の人の応答が後に着地すると `galleries` と `galleriesFor` が前の人で
   *  固定される ── そうなると下の自動作成は「一覧が今の人のものではない」と判断して
   *  永久に止まり、**新しい人に部屋もウィザードも出ない**まま前の人の部屋が表示される。 */
  const reloadGen = useRef(0)
  const reload = useCallback(async () => {
    if (!user) return
    const gen = ++reloadGen.current
    const fresh = () => gen === reloadGen.current
    try {
      const list = await listMyGalleries(user.id)
      if (!fresh()) return
      setGalleries(list)
      setLoadErr('')
    } catch (e) {
      console.error('could not load galleries (are supabase/migrations applied?):', e)
      if (!fresh()) return
      setLoadErr(t('me.loadFailed'))
      setGalleries([])
    }
    // **この一覧が誰のものかを一緒に覚える**（4巡目の別視点レビューで検出）。同じタブで
    // アカウントが差し替わっても（supabase は別タブのサインインを伝えてくる）`galleries`
    // は前の人のまま残るので、`user` だけを見て判断すると**前の人の部屋数を新しい人の
    // 事実として記録してしまう**（実害: 新規の人に自動作成が二度と走らなくなる）。
    setGalleriesFor(user.id)
    try {
      const bytes = await getStorageUsage(user.id)
      if (fresh()) setUsage(bytes)
    } catch {
      if (fresh()) setUsage(null) // storage unconfigured or unreachable — hide the meter
    }
    try {
      // 作品スロットの合計（migration 0052の「移動」を撤回し、口座内の全部屋
      // ── 合同展示の部屋も含む ── のwork_capを合算した1つの数字にする。
      // ユーザー指摘 2026-08-11: 部屋ごとの数字を分けて考えたくない。
      const all = await listAllOwnedRooms(user.id)
      if (fresh()) setAllOwnedRooms(all)
    } catch {
      if (fresh()) setAllOwnedRooms(null) // 取れないときは呼び手がこの部屋自身のwork_capへフォールバックする
    }
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * 部屋が1つも無い口座には、**その場で無料の部屋を1つ作る**（ユーザー決定 2026-08-14）。
   *
   * なぜ要るか: 登録時にできるのは `profiles` の行だけで、部屋は下の `CreateCard`
   * （2ステップのウィザード）を完了して初めてできた。ところが合同展示に招かれた作家は、
   * 承諾で自分の展示用の部屋ができても `listMyGalleries` がそれを除外するので、ここが
   * **「0室」に見えたままウィザードが出続け、先に進めなかった**（本番でのユーザー報告
   * 2026-08-14）。
   *
   * 選ばせずに作ってよい理由: 無料枠のテーマ／間取りは `whitecube`/`corridor` の
   * 1つずつだけ（`lib/entitlements` の `FOREVER_FREE_*`）なので、**無料ユーザーが
   * 選べるテンプレートは元から `studio`（White Cube）1つ**だった。ウィザードは4枚
   * 見せていたが3枚は鍵付きで、選ぶと「続ける」が押せない。つまり選択肢は1つも
   * 減らない。有料のテーマ／間取りは「部屋」タブに鍵付きで並び、そこから実物の
   * プレビュー付きで買えるので、売り場も失われない。
   *
   * **DBのトリガ（`handle_new_user`）にはしない。** 「最初の部屋の作り方」（無料テーマ・
   * 無料間取り・5枠・無料等級）のレシピが `lib/` とSQLの2か所に増えるため
   * （DECISIONS【絶対ルール】2026-08-12）。ここで `createGallery` を呼べばレシピは1か所。
   */
  /** 自動作成がいま走っているか。**走っている最中はウィザードを出さない**
   *  （3巡目の別視点レビューで検出）── 作成中に auth のイベントで `galleries` の
   *  identity だけが変わると、この effect が再入して「まだ0室」と読み、消したはずの
   *  ウィザードが割り込んで出ていた（着地すると入力中でも消える）。 */
  const autoRoomCreating = useRef(false)
  /** 自動作成を**試したユーザー**（成否を問わず1人につき1回）。失敗してウィザードを
   *  出したあとに、`user` オブジェクトの作り直し（トークン更新など）で effect が
   *  再入して**2回目の作成が入力中のウィザードの裏で走る**のを防ぐ（4巡目の別視点
   *  レビューで検出）。ユーザーidで持つので、アカウントを切り替えれば仕切り直しになる。 */
  const autoRoomAttempted = useRef<string | null>(null)
  const [showCreateCard, setShowCreateCard] = useState(false)
  useEffect(() => {
    if (!user || loadErr || galleries === null) return
    // **いま手元にある一覧が、いまのユーザーのものだと確かめてから判断する。**
    if (galleriesFor !== user.id) return
    // 「一度でも部屋を持った」は**この口座の事実**なので、マウント限りの ref ではなく
    // ブラウザに残す（3巡目の別視点レビューで検出）。ref だと、最後の部屋を削除した人が
    // **リロードしただけで部屋が黙って作り直され**、削除ボタンが効いていないように見える。
    const key = `${HAD_ROOM_KEY}.${user.id}`
    if (galleries.length > 0) {
      try { localStorage.setItem(key, '1') } catch { /* 保存できなくても動作は変えない */ }
      setShowCreateCard(false)
      return
    }
    // 走っている最中は何も出さない（出すと作成中にウィザードが割り込む）。
    if (autoRoomCreating.current) return
    // 試して終わったのにまだ0室＝作成に失敗した。**作り直さずウィザードを出したまま**にする。
    if (autoRoomAttempted.current === user.id) {
      setShowCreateCard(true)
      return
    }
    let had = false
    try { had = localStorage.getItem(key) === '1' } catch { /* 読めなければ「初めて」扱い */ }
    if (had) {
      // 持っていたのに0室＝自分で削除した。本人の意思なので黙って作り直さない。
      setShowCreateCard(true)
      return
    }
    autoRoomAttempted.current = user.id
    autoRoomCreating.current = true
    // **時間切れでウィザードを出す逃げ道は置かない**（5巡目の別視点レビューで撤去した）。
    // 一度書いてみたが、回線が遅くて作成に8秒以上かかると**ウィザードが出た直後に
    // 作成が着地して、入力中のウィザードが消える**（あるいは利用者が先に完走して
    // 2本目の作成が走り「もう部屋は作れません」で弾かれる）。作成が遅いだけの人に
    // 壊れた体験を配る方が、応答が返らない稀な人を救うより高くつく。返らないときは
    // ブラウザ側が最後には失敗させ、その `catch` でウィザードが出る。
    void (async () => {
      try {
        // 題は空のまま（`createGallery` の作法）。表示側は題が空なら作家名を先に出す。
        await createGallery(user.id, { title: '', templateId: 'studio' })
        track('me_room_auto_create', {})
        await reload()
      } catch (e) {
        // **画面は止めない。** 失敗したらウィザードをそのまま出して手で作ってもらう
        // （オフライン・RLSの想定外など、ここで詰ませるとアカウントが使えなくなる）。
        console.error('could not create the first room automatically:', e)
        setShowCreateCard(true)
      } finally {
        autoRoomCreating.current = false
      }
    })()
  }, [user, loadErr, galleries, galleriesFor, reload])

  /**
   * どの部屋を開くか。**初回は合同展示の部屋を開く**（ユーザー決定 2026-08-14:
   * 「参加表明して承認されてダッシュボードに行ったら、合同展示のダッシュボードが
   * 開いている状態になっている」）。2回目以降は前に開いていた部屋に戻す。
   *
   * 復元を mount 後の effect でやるのは `stage` と同じ理由（初期値で `localStorage` を
   * 読むと、サーバが描いたHTMLと食い違って hydration が壊れる）。**書き込みは復元が
   * 済むまでしない** ── mount 直後は「復元 → 保存」の順に走るので、保存側が先に
   * 初期値（null）を書くと、その一瞬でタブを閉じられた人の記憶が消える。
   */
  const roomRestored = useRef(false)
  useEffect(() => {
    if (roomRestored.current) return
    // **利用者が先に部屋を選んでいたら、記憶で上書きしない。** 受信箱の「自分の部屋を
    // 開く」や `ExpoManager` の「部屋を開く」は一覧の到着より先に押せるので、ここで
    // 無条件に復元すると**押した部屋が一瞬で別の部屋にすり替わる**。
    if (roomId) {
      roomRestored.current = true
      return
    }
    // 一覧が届くまで待つ（届く前に決めると、保存された id が「一覧に無い」と判定される）。
    if (!allOwnedRooms || allOwnedRooms.length === 0) return
    roomRestored.current = true
    const saved = localStorage.getItem(ROOM_KEY)
    if (saved && allOwnedRooms.some((g) => g.id === saved)) {
      setRoomId(saved)
      return
    }
    // 記憶が無い（＝承認された直後に初めて来た人を含む）。合同展示の部屋があれば
    // そちらを開く。無ければ `roomId` は null のままで、玄関の部屋が開く。
    const joint = allOwnedRooms.find((g) => g.expo_id)
    if (joint) setRoomId(joint.id)
  }, [allOwnedRooms, roomId])
  useEffect(() => {
    if (!roomRestored.current || !roomId) return
    localStorage.setItem(ROOM_KEY, roomId)
  }, [roomId])

  // How many rooms this account may own: the free one plus one per $25 purchase.
  const owned = usePurchasedIds(user?.id ?? null)
  const rooms = galleries ?? []
  // Grants held but not yet built against, counted by GRADE (free vs. paid) so a
  // deleted free room cannot be rebuilt as a paid one — see lib/limits.gradeForNewRoom.
  const waiting = unbuiltRooms(tallyRooms(rooms), owned.rooms)
  // `mainRoomOf` owns the pre-0036 fallback (no flag → the oldest room), so every
  // consumer here agrees on which room `/@name` renders.
  const frontDoor = mainRoomOf(rooms)
  // `rooms`（`listMyGalleries`）は合同展示の部屋を弾く（`lib/galleries.ts` 冒頭参照）ので、
  // ExpoManager の「部屋を開く」で立てた `roomId` がそこに無いことがある。**見つからない
  // ときは黙って玄関の部屋に化けさせず、id で直接引く**（見つかるまでは玄関に留まる＝
  // 何も壊れて見えない）。
  const [expoRoom, setExpoRoom] = useState<GalleryRow | null>(null)
  useEffect(() => {
    if (!user || !roomId || rooms.some((g) => g.id === roomId)) {
      setExpoRoom(null)
      return
    }
    let alive = true
    void getGalleryById(roomId).then((r) => {
      if (alive) setExpoRoom(r)
    }).catch(() => {
      if (alive) setExpoRoom(null)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roomId, galleries])
  const current = rooms.find((g) => g.id === roomId) ?? expoRoom ?? frontDoor
  /** An unused room grant — bought a room but hasn't built it yet. */
  const canBuildRoom = rooms.length > 0 && waiting > 0

  // Hero の「あなたの展示のURL」の差し替え用（ユーザー指摘 2026-08-13）。`GalleryCard`
  // も同じ形で自分の展示を取っているが、Hero はそれより上に描かれる兄弟コンポーネントで
  // 状態を共有していないので、ここで同じだけ取る（`current.expo_id` が変わるたびに1回、
  // 軽いクエリ）。
  const [heroExpo, setHeroExpo] = useState<Expo | null>(null)
  useEffect(() => {
    if (!current?.expo_id) {
      setHeroExpo(null)
      return
    }
    let alive = true
    void getExpoById(current.expo_id).then((x) => {
      if (alive) setHeroExpo(x)
    }).catch(() => {
      if (alive) setHeroExpo(null)
    })
    return () => {
      alive = false
    }
  }, [current?.expo_id])

  // Stable across renders so the context value doesn't invalidate every consumer.
  const openRoomOffer = useCallback(() => setRoomOfferOpen(true), [])

  /** Build a room against an unused grant. Titled by position rather than asking up
   *  front: the room is renamed on the publish stage anyway, and a modal here would
   *  stand between paying and seeing the thing paid for. */
  async function buildRoom() {
    if (!user || !canBuildRoom) return
    setCreatingRoom(true)
    try {
      const created = await createGallery(user.id, {
        title: t('me.roomDefaultTitle', { n: rooms.length + 1 }),
        roomsPurchased: owned.rooms,
      })
      track('room_created', { rooms: rooms.length + 1, purchased: owned.rooms })
      await reload()
      setRoomId(created.id)
      showToast()
    } catch (e) {
      alert(t('me.actionFailed', { label: t('me.roomAdd'), msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      setCreatingRoom(false)
    }
  }

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
    <RoomOfferContext.Provider value={openRoomOffer}>
    <main className="me-page">
      {toast && (
        <div className="me-toast" role="status" aria-live="polite" key={toast.n}>{toast.msg}</div>
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {/* 合同展示。**部屋を開く**を押すと通常の部屋エディタでその部屋に入る（エディタを
          二重に作らない）。合同展示の部屋は `listMyGalleries` が落としているので、
          部屋タブには出てこない ── だから明示的に `setRoomId` してから gallery タブへ移す。 */}
      {expoManagerOpen && user && (
        <ExpoManager
          onOpenRoom={(id) => {
            setRoomId(id)
            setTab('gallery')
            setExpoManagerOpen(false)
          }}
          onClose={() => setExpoManagerOpen(false)}
        />
      )}
      {roomOfferOpen && (
        <PurchaseModal
          itemLabel={t('me.roomAdd')}
          flat={{ cents: PRICE_USD_CENTS.room, kind: 'room' }}
          intent={{ kind: 'room', itemKey: '' }}
          onClose={() => setRoomOfferOpen(false)}
        />
      )}
      <div className="me-inner">
        <div className="me-top">
          <LocaleLink href="/" className="auth-logo" onClick={guardLeave}>XIBIT360</LocaleLink>
          <TopActions before={<NotificationBell />}>
            <LocaleLink className="btn-line" href="/explore" onClick={guardLeave}>{t('me.explore')}</LocaleLink>
            <button className="btn-line" onClick={() => setHelpOpen(true)}>{t('help.title')}</button>
            {isAdmin && (
              <Link className="btn-line btn-gold" href="/admin" onClick={guardLeave}>{t('me.admin')}</Link>
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
            <Hero
              expo={tab === 'gallery' ? heroExpo : null}
              topRight={
                tab === 'gallery' && current ? (
                  <RoomExpoBadge
                    room={current}
                    userId={user.id}
                    /* 通常展示へ戻る＝玄関の部屋を開く（ユーザー指示 2026-08-14）。
                       `roomId` を null に戻すのではなく**明示的に玄関の id を入れる**
                       ── null は「まだ選んでいない」の意味で、記憶の復元 effect が
                       合同展示の部屋を開き直してしまう。
                       **通常展示の部屋が1室も無いときは渡さない**（別視点レビューで検出）。
                       渡すと押せるのに何も起きないボタンになる ── 合同展示の部屋では
                       部屋タブを隠しているので、ここが唯一の帰り道になっている。
                       0室は「最後の1室を自分で削除した」等で実際に起こりうる。 */
                    onOpenNormal={frontDoor ? () => setRoomId(frontDoor.id) : null}
                    onOpenExpoManager={() => setExpoManagerOpen(true)}
                    onChanged={() => void reload()}
                  />
                ) : (
                  <button className="btn-line" onClick={() => setExpoManagerOpen(true)}>{t('expo.tab')}</button>
                )
              }
            />
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
                {/* 招待の受信箱。招待が無ければ何も描かない（GuestImportCard と同じ作法）。
                    ここに置いたのは、**招かれたことに気づく場所が他に無い**から
                    （通知の仕組みは無く、主催者は「送った」と思っている）。 */}
                <InviteInbox />
                <section className="me-section">
                  {/* A bare heading only while there's no gallery card yet (loading / empty).
                      The card itself carries the stage bar and needs no separate header. */}
                  {(galleries === null || galleries.length === 0) && <h2>{t('me.myGallery')}</h2>}
                  {loadErr && <p className="me-error">{loadErr}</p>}
                  {galleries === null && !loadErr && <p className="me-note">{t('me.loading')}</p>}
                  {/* 部屋が0室のときは、上の effect が黙って1室作る（ユーザー決定
                      2026-08-14）。ウィザードは**その自動作成が失敗したときの退路**
                      としてだけ残す ── 出しっぱなしにすると、合同展示に招かれた作家の
                      画面に「最初の部屋を作りましょう」が居座る（今回の不具合）。 */}
                  {galleries !== null && !loadErr && galleries.length === 0 && (
                    showCreateCard
                      ? <CreateCard onCreated={() => void reload()} />
                      : <p className="me-note">{t('me.loading')}</p>
                  )}
                  {current && (
                    <GalleryCard
                      key={current.id}
                      row={current}
                      onChanged={() => void reload()}
                      roomCount={rooms.length}
                      isMain={current.id === frontDoor?.id}
                      poolCapacity={allOwnedRooms ? poolCapacityOf(allOwnedRooms) : null}
                      placedElsewhere={allOwnedRooms ? elsewherePlacedWorkIds(allOwnedRooms, current.id) : EMPTY_ELSEWHERE}
                      placedElsewhereCount={allOwnedRooms ? elsewherePlacedCount(allOwnedRooms, current.id) : 0}
                      stage={stage}
                      onStageChange={setStage}
                      /* 部屋の切替タブ（ユーザー指示 2026-08-10: 「部屋」「配置」ステージの
                         中だけに置く。UIとロジックは変えず場所だけ動かした）。 */
                      rooms={rooms}
                      frontDoorId={frontDoor?.id ?? null}
                      onSwitchRoom={(id) => {
                        const g = rooms.find((r) => r.id === id)
                        track('room_switch', { to: g?.slug, main: id === frontDoor?.id })
                        setRoomId(id)
                      }}
                      /* 「参加者」タブから、承諾済みの作家の自動生成の部屋へ飛ぶ
                         （migration 0062）。`rooms` には合同展示の部屋は乗らないので
                         `track` の部屋名は素直に引けない ── id だけ渡す。 */
                      onOpenRoom={(id) => {
                        track('expo_room_open', { room: id })
                        setRoomId(id)
                        // **「部屋」タブへ移す**（ユーザー指摘 2026-08-14 と同じ筋）。
                        // 「参加者」タブに留まったままだと、開いたあとも同じ参加者一覧が
                        // 出ているので**押しても何も起きていないように見える**（変わるのは
                        // 読み取り専用の断り書きが増えることだけ）。
                        setStage('room')
                      }}
                      /* 未使用の部屋枠、または購入の誘い。**「部屋」ステージの中**に置く
                         （ユーザー指示 2026-08-09「部屋の中に追加して欲しい」）。以前は
                         ダッシュボード直下＝どのステージを見ていても足元に居たので、
                         「いま編集している部屋の設定」と見分けがつかなかった。 */
                      /* 部屋タブ（`.me-room-tab`）と同じ形のピル1つに簡略化
                         （ユーザー指示 2026-08-11: 「展示室追加ボタンは、部屋タブと
                         同じ形で横並びにして」）。説明文は`title`（ホバーで見える）に
                         退避させ、見た目は部屋タブ列に馴染む1枚のピルにする。 */
                      roomAdd={
                        galleries !== null && rooms.length > 0 ? (
                          canBuildRoom ? (
                            <button
                              type="button"
                              className="me-room-tab me-room-add-tab ready"
                              disabled={creatingRoom}
                              title={t('me.roomGrantWaiting', { count: waiting })}
                              onClick={() => void buildRoom()}
                            >
                              {creatingRoom ? t('me.roomAdding') : t('me.roomBuild')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="me-room-tab me-room-add-tab"
                              title={t('me.roomAddWhy', { price: PRICE_ROOM, slots: MAX_WORKS_PER_ROOM })}
                              onClick={() => setRoomOfferOpen(true)}
                            >
                              {t('me.roomAdd')}
                            </button>
                          )
                        ) : null
                      }
                    />
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
                {/* アカウントタブには `GalleryCard`（＝タブの行と保存ボタン）が無いので、
                    未保存のまま来た人が保存できなくなる（別視点レビューで検出）。
                    **同時に2つは出ない**（このタブでは上の行が存在しない）ので、
                    読み上げが二重になる心配もない。 */}
                {dirty && (
                  <div className="me-save-slot me-save-slot--card">
                    <span className="me-save-note">{t('me.unsavedNote')}</span>
                    <SaveAllButton />
                  </div>
                )}
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
    </RoomOfferContext.Provider>
    </ToastContext.Provider>
  )
}
