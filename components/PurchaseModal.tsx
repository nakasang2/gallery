'use client'
// The tap-through from anything locked — a theme/layout/frame chip, or extra
// room capacity. With an `intent`, the CTA starts a real Stripe Checkout via
// /api/checkout; while billing isn't configured (or no intent is given) it
// falls back to the same honest "not live yet" note rather than faking a buy.
//
// Two shapes: a single `item` being unlocked (theme/layout/frame), or a
// `quantity` stepper (capacity — buy N slots in one checkout, DECISIONS 2026-07-24).
//
// Every word here comes from the dictionary. It used to build its own English
// ("New theme", "Chic only", "Unlocks just this theme…") in lib/pricing, which
// `check:i18n` does not scan — so the paywall, of all screens, was English in all
// eleven languages (docs/LESSONS 2026-07-29).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { itemPriceCents, usd, type PaidKind } from '@/lib/pricing'
import { startCheckout, type PurchaseIntent } from '@/lib/checkout'
import { useT } from '@/components/I18nProvider'

const EYEBROW: Record<PaidKind | 'capacity', string> = {
  theme: 'purchase.eyebrowTheme',
  layout: 'purchase.eyebrowLayout',
  frame: 'purchase.eyebrowFrame',
  capacity: 'purchase.eyebrowCapacity',
}

const UNLOCKS: Record<PaidKind, string> = {
  theme: 'purchase.unlocksTheme',
  layout: 'purchase.unlocksLayout',
  frame: 'purchase.unlocksFrame',
}

export default function PurchaseModal({
  itemLabel,
  item,
  preview,
  quantity,
  intent,
  onClose,
}: {
  itemLabel: string
  /** The single thing being unlocked (theme/layout/frame). Its price comes from
   *  the price table, so the modal quotes exactly what checkout will charge.
   *  Omit when using `quantity`. */
  item?: { kind: PaidKind; itemKey: string }
  preview?: React.ReactNode
  /** Quantity-picker mode (capacity): pay for N units in one checkout.
   *  The unit is always a work slot, so its name is written into each language's
   *  sentence rather than interpolated — a noun dropped into `{unit}` cannot
   *  carry the plural and particle agreement the sentence needs (German wants
   *  Platz/Plätze, Spanish lugar/lugares, Korean 를 after a vowel). If a second
   *  kind of unit ever ships, give it its own keys instead of a placeholder. */
  quantity?: { unitCents: number; max: number }
  /** What checkout should buy — omit to keep the modal preview-only */
  intent?: PurchaseIntent
  onClose: () => void
}) {
  const t = useT()
  const [qty, setQty] = useState(1)
  // Why the buy never started. 'signed-out' is kept apart from 'not-live'
  // because they need opposite things from the buyer — one can act, the other
  // can only wait (docs/DECISIONS 2026-07-29).
  const [blocked, setBlocked] = useState<'not-live' | 'signed-out' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The CTA used to be `disabled` until this was ticked, so tapping it did
  // nothing at all and said nothing — on a phone the checkbox is 16px of grey
  // fine print, easy to miss. The button stays live and explains instead.
  const [consentMissing, setConsentMissing] = useState(false)
  // EU/UK consumers keep a 14-day right to cancel digital content UNLESS they
  // ask for it immediately and acknowledge losing that right. The upgrade
  // unlocks the moment the webhook lands, so we have to take that here — and
  // here rather than in Stripe's own consent_collection, which needs a URL
  // configured in the dashboard and would break silently if it were missing.
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const qtyMax = quantity ? Math.max(1, quantity.max) : 1
  const clampedQty = Math.min(qty, qtyMax)

  async function onCta() {
    if (!intent) {
      setBlocked('not-live')
      return
    }
    if (!acknowledged) {
      setConsentMissing(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const start = await startCheckout(intent, clampedQty)
      if (start.kind === 'redirect') {
        window.location.assign(start.url)
        return // keep the button disabled while the browser navigates
      }
      setBlocked(start.kind === 'signed-out' ? 'signed-out' : 'not-live')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('purchase.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="purchase-backdrop" onClick={onClose}>
      <div
        className="purchase-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('purchase.buyAria', { name: itemLabel })}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="purchase-close" aria-label={t('purchase.close')} onClick={onClose}>×</button>
        {preview && <div className="purchase-preview">{preview}</div>}
        <p className="purchase-eyebrow">{t(EYEBROW[item?.kind ?? 'capacity'])}</p>
        <h3 className="purchase-title">{itemLabel}</h3>

        {quantity ? (
          <div className="purchase-qty">
            <div className="purchase-qty-row">
              <span className="purchase-qty-label">{t('purchase.howMany')}</span>
              <div className="purchase-stepper">
                <button
                  type="button"
                  aria-label={t('purchase.fewerAria')}
                  disabled={clampedQty <= 1}
                  onClick={() => setQty((n) => Math.max(1, n - 1))}
                >
                  −
                </button>
                <span className="purchase-qty-value">{clampedQty}</span>
                <button
                  type="button"
                  aria-label={t('purchase.moreAria')}
                  disabled={clampedQty >= qtyMax}
                  onClick={() => setQty((n) => Math.min(qtyMax, n + 1))}
                >
                  +
                </button>
              </div>
            </div>
            <div className="purchase-qty-total">
              <span>{usd(quantity.unitCents)} × {clampedQty}</span>
              <span className="purchase-price">{usd(quantity.unitCents * clampedQty)}</span>
            </div>
            <p className="purchase-option-desc">
              {t('purchase.optionDesc', { count: clampedQty, max: qtyMax })}
            </p>
          </div>
        ) : item ? (
          /* Exactly one thing is ever on offer here — the bundle that needed a
             radio list was retired (DECISIONS 2026-07-24). The radio stays as the
             selected-state affordance so the row looks unchanged. */
          <div className="purchase-options">
            <label className="purchase-option selected">
              <input type="radio" name="purchase-option" checked readOnly />
              <div>
                <div className="purchase-option-label">
                  <span>{t('purchase.soloItem', { name: itemLabel })}</span>
                  <span className="purchase-price">{usd(itemPriceCents(item.kind, item.itemKey))}</span>
                </div>
                <div className="purchase-option-desc">{t(UNLOCKS[item.kind])}</div>
              </div>
            </label>
          </div>
        ) : null}

        {blocked === 'signed-out' ? (
          /* The sign-in lapsed — the one dead end the buyer can actually clear.
             /signin returns to /me, which is where every purchase starts. */
          <>
            <p className="purchase-note purchase-note-active">{t('purchase.signedOut')}</p>
            <Link className="btn-line purchase-signin" href="/signin">
              {t('common.signIn')}
            </Link>
          </>
        ) : blocked === 'not-live' ? (
          <p className="purchase-note purchase-note-active">
            {t('purchase.notLive')}
          </p>
        ) : (
          <>
            {intent && (
              <label className={`purchase-consent${consentMissing ? ' needs-consent' : ''}`}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => {
                    setAcknowledged(e.target.checked)
                    if (e.target.checked) setConsentMissing(false)
                  }}
                />
                <span>
                  {t('purchase.consent')}
                </span>
              </label>
            )}
            <button className="purchase-cta" onClick={() => void onCta()} disabled={busy}>
              {busy ? t('purchase.opening') : t('purchase.continueToCheckout')}
            </button>
            {error ? (
              <p className="purchase-note purchase-note-active">{error}</p>
            ) : consentMissing ? (
              <p className="purchase-note purchase-note-active">{t('purchase.needsConsent')}</p>
            ) : (
              /* Capacity buys slots that stay with the room; everything else is a
                 one-off unlock. Both sentences were already in the dictionary —
                 the caller used to pass the English one as a prop. */
              <p className="purchase-note">
                {quantity ? t('purchase.oneTimeSlots') : t('purchase.oneTimeNote')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
