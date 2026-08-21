// Google Analytics 4 (gtag.js) — the one place that talks to Google.
//
// Everything here no-ops when NEXT_PUBLIC_GA_ID is unset, the same way billing
// and TTS answer 501 when their keys are missing: a missing key must never look
// like a broken feature, and local/preview builds must not pollute the property.
//
// GA4's own rules are enforced here rather than trusted to call sites:
//   • event names: ≤40 chars, [A-Za-z][A-Za-z0-9_]*  (dots are NOT allowed —
//     docs/ANALYTICS.md's original `gallery.work.focus` notation is snake_case here)
//   • ≤25 parameters per event, name ≤40 chars, value ≤100 chars
//   • a parameter only appears in GA4's reports once it is registered as a custom
//     dimension in the property (Admin → Custom definitions). Unregistered ones
//     are still in the BigQuery export, but they will look "missing" in the UI.
//
// Ad blockers drop gtag.js outright for a meaningful share of visitors, so these
// numbers are a floor, not a census. The Supabase-backed counts (lib/engagement)
// stay the source of truth for anything shown to an artist about their own room.

/** GA4 measurement ID (G-XXXXXXXXXX). Empty = analytics off. */
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? ''
export const gaConfigured = GA_ID.length > 0

/** EEA + UK + Switzerland: consent is denied by default in these regions and
 *  granted elsewhere (Consent Mode v2 regional defaults). Kept here so the
 *  inline bootstrap script and any future banner read the same list. */
export const CONSENT_DENIED_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
]

type ParamValue = string | number | boolean | null | undefined
export type EventParams = Record<string, ParamValue>

const EVENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const MAX_PARAMS = 25
const MAX_VALUE_CHARS = 100

interface GtagWindow extends Window {
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
}

function gtag(...args: unknown[]): void {
  const w = window as GtagWindow
  // Push straight onto the queue rather than calling w.gtag: events fired before
  // gtag.js finishes downloading would otherwise be dropped, and the whole point
  // of the early events (loading timeout, abandon) is that they happen early.
  ;(w.dataLayer = w.dataLayer ?? []).push(args)
}

/** Trim a parameter to what GA4 will actually store. */
function clean(value: ParamValue): string | number | boolean | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  const s = String(value)
  return s.length > MAX_VALUE_CHARS ? s.slice(0, MAX_VALUE_CHARS) : s
}

/**
 * Send one GA4 event. Fire-and-forget: never awaited, never throws, never
 * blocks a render. Silently does nothing when analytics is off or during SSR.
 */
export function track(name: string, params: EventParams = {}): void {
  if (!gaConfigured || typeof window === 'undefined') return
  if (!EVENT_NAME_RE.test(name)) {
    // A rejected name is a coding error, not a runtime condition — say so loudly
    // in the console rather than shipping an event GA4 will discard in silence.
    console.warn(`analytics: "${name}" is not a valid GA4 event name — event dropped`)
    return
  }
  try {
    const out: Record<string, string | number | boolean> = {}
    let n = 0
    for (const [k, v] of Object.entries(params)) {
      const value = clean(v)
      if (value === undefined) continue
      if (++n > MAX_PARAMS) break
      out[k.slice(0, 40)] = value
    }
    gtag('event', name, out)
  } catch {
    /* analytics must never interrupt the product */
  }
}

/** Manual page_view (the config call sets send_page_view:false — App Router
 *  navigations are client-side, so gtag would otherwise report only the first). */
export function trackPageView(path: string): void {
  if (!gaConfigured || typeof window === 'undefined') return
  gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  })
}

export interface PurchaseItem {
  item_id: string
  item_name: string
  price?: number
  quantity?: number
}

/**
 * GA4's recommended ecommerce `purchase` event. Separate from `track()` because
 * its `items` parameter is an ARRAY of objects — `track()`'s `clean()` only
 * handles flat scalars, and stringifying/dropping `items` would defeat the point
 * (リリース前監査 #18: the previous signal, `checkout_return`, carried no value,
 * SKU, or transaction id at all).
 */
export function trackPurchase(payload: {
  transactionId: string
  value: number
  currency: string
  items: PurchaseItem[]
}): void {
  if (!gaConfigured || typeof window === 'undefined') return
  try {
    gtag('event', 'purchase', {
      transaction_id: payload.transactionId,
      value: payload.value,
      currency: payload.currency,
      items: payload.items,
    })
  } catch {
    /* analytics must never interrupt the product */
  }
}

/* ================= Consent ================= */

/** Where the visitor's own choice is remembered. Read synchronously by the
 *  bootstrap script in components/Analytics so a returning visitor who already
 *  agreed is measured from their very first hit, with no consent-update race. */
export const CONSENT_KEY = 'xibit360.consent.v1'

export type ConsentChoice = 'granted' | 'denied'

/** The stored choice, or null when this visitor has never answered. */
export function readConsent(): ConsentChoice | null {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null // private mode — treat as unanswered, the banner will ask again
  }
}

/** Record the visitor's choice and tell gtag about it immediately. */
export function setConsent(choice: ConsentChoice): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CONSENT_KEY, choice)
  } catch {
    /* the gtag update below still applies to this page view */
  }
  if (!gaConfigured) return
  gtag('consent', 'update', { analytics_storage: choice })
}

/** Grant analytics storage. */
export function grantAnalyticsConsent(): void {
  setConsent('granted')
}

/** Withdraw it. Withdrawing has to be as easy as giving it (GDPR art. 7(3)),
 *  which is what components/ConsentReset offers on the privacy page. */
export function denyAnalyticsConsent(): void {
  setConsent('denied')
}

/** Forget the choice so the banner asks again. */
export function clearConsent(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(CONSENT_KEY)
  } catch {
    /* nothing to forget */
  }
}

/* ================= Cross-cutting state ================= */

/**
 * How the work about to be focused was reached. Set by the call site immediately
 * before triggering the focus; read and cleared by AnalyticsProbe when the store
 * changes. A module singleton for the same reason lib/controller.ts holds
 * `walkRef`/`camPose`: this crosses the React tree and must not cause renders.
 *
 * Without it every focus looks identical, and a guided-tour view would be counted
 * as a visitor choosing that work — which would make the "most viewed" number a
 * measure of slot order rather than interest.
 */
export type FocusVia = 'click' | 'stepper' | 'key' | 'swipe' | 'tour' | 'unknown'
export const focusIntent = { via: 'unknown' as FocusVia }

export function setFocusIntent(via: FocusVia): void {
  focusIntent.via = via
}

/** What the visitor did this session, for the single exit summary (F2). Reset
 *  when a gallery is entered. */
export const sessionFlags = {
  liked: false,
  shared: false,
  signed: false, // left a guestbook entry
  /** The loading screen finished and the room was actually shown. False in the
   *  exit summary = the visitor left while still looking at the door. */
  roomOpened: false,
  worksFocused: new Set<string>(),
  maxDepth: 0,
}

export function resetSessionFlags(): void {
  sessionFlags.liked = false
  sessionFlags.shared = false
  sessionFlags.signed = false
  sessionFlags.roomOpened = false
  sessionFlags.worksFocused = new Set()
  sessionFlags.maxDepth = 0
}
