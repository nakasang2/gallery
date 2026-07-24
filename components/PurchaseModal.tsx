'use client'
// The tap-through from anything locked — a theme/layout chip, or extra room
// capacity. With an `intent`, the CTA starts a real Stripe Checkout via
// /api/checkout; while billing isn't configured (or no intent is given) it
// falls back to the same honest "not live yet" note rather than faking a buy.
//
// Two shapes: a radio list of `options` (themes/layouts), or a `quantity`
// stepper (capacity — buy N slots in one checkout, docs/DECISIONS 2026-07-24).
import { useEffect, useState } from 'react'
import { usd, type PurchaseOption } from '@/lib/pricing'
import { startCheckout, type PurchaseIntent } from '@/lib/checkout'

export default function PurchaseModal({
  itemLabel,
  eyebrow,
  preview,
  options = [],
  quantity,
  intent,
  previewNote = 'This is a preview of how buying a theme or layout will work.',
  onClose,
}: {
  itemLabel: string
  /** Small label above the title — gives the price context at a glance, e.g. "New theme" */
  eyebrow?: string
  preview?: React.ReactNode
  /** Radio options (themes/layouts). Omit when using `quantity`. */
  options?: PurchaseOption[]
  /** Quantity-picker mode (capacity): pay for N units in one checkout. */
  quantity?: { unitCents: number; max: number; unitLabel: string }
  /** What checkout should buy — omit to keep the modal preview-only */
  intent?: PurchaseIntent
  /** Footer copy while the CTA is untried — override for non-theme/layout purchases */
  previewNote?: string
  onClose: () => void
}) {
  const [selected, setSelected] = useState(options[0]?.key ?? '')
  const [qty, setQty] = useState(1)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setTried(true)
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
      setTried(true) // billing not configured / signed out — honest note, not a fake buy
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed — please try again.')
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
        aria-label={`Buy ${itemLabel}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="purchase-close" aria-label="Close" onClick={onClose}>×</button>
        {preview && <div className="purchase-preview">{preview}</div>}
        {eyebrow && <p className="purchase-eyebrow">{eyebrow}</p>}
        <h3 className="purchase-title">{itemLabel}</h3>

        {quantity ? (
          <div className="purchase-qty">
            <div className="purchase-qty-row">
              <span className="purchase-qty-label">How many {quantity.unitLabel}s?</span>
              <div className="purchase-stepper">
                <button
                  type="button"
                  aria-label={`Fewer ${quantity.unitLabel}s`}
                  disabled={clampedQty <= 1}
                  onClick={() => setQty((n) => Math.max(1, n - 1))}
                >
                  −
                </button>
                <span className="purchase-qty-value">{clampedQty}</span>
                <button
                  type="button"
                  aria-label={`More ${quantity.unitLabel}s`}
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
              Adds {clampedQty} more {quantity.unitLabel}
              {clampedQty > 1 ? 's' : ''} to this room, once, forever. {qtyMax} available.
            </p>
          </div>
        ) : (
          <div className="purchase-options">
            {options.map((opt) => (
              <label key={opt.key} className={`purchase-option${selected === opt.key ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="purchase-option"
                  checked={selected === opt.key}
                  onChange={() => setSelected(opt.key)}
                />
                <div>
                  <div className="purchase-option-label">
                    <span>{opt.label}</span>
                    <span className="purchase-price">{opt.price}</span>
                  </div>
                  <div className="purchase-option-desc">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        )}

        {tried ? (
          <p className="purchase-note purchase-note-active">
            Checkout isn&apos;t live yet — you&apos;ll be able to buy this the moment it ships.
          </p>
        ) : (
          <>
            <button className="purchase-cta" onClick={() => void onCta()} disabled={busy}>
              {busy ? 'Opening checkout…' : 'Continue to checkout'}
            </button>
            {error ? (
              <p className="purchase-note purchase-note-active">{error}</p>
            ) : (
              <p className="purchase-note">{previewNote}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
