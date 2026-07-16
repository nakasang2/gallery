'use client'
// The tap-through from anything locked — a theme/layout chip, a full room, or
// Design Tools (REQUIREMENTS.md §11.5/§11.8's "tapping lets you choose a
// single purchase or the Collection"). With an `intent`, the CTA starts a real
// Stripe Checkout via /api/checkout; while billing isn't configured (or no
// intent is given) it falls back to the same honest "not live yet" note as
// before rather than faking a purchase.
import { useEffect, useState } from 'react'
import type { PurchaseOption } from '@/lib/pricing'
import { startCheckout, type PurchaseIntent } from '@/lib/checkout'

export default function PurchaseModal({
  itemLabel,
  eyebrow,
  preview,
  options,
  intent,
  previewNote = 'This is a preview of how buying a theme or layout will work.',
  onClose,
}: {
  itemLabel: string
  /** Small label above the title — gives the price context at a glance, e.g. "New theme" */
  eyebrow?: string
  preview?: React.ReactNode
  options: PurchaseOption[]
  /** What checkout should buy — omit to keep the modal preview-only */
  intent?: PurchaseIntent
  /** Footer copy while the CTA is untried — override for non-theme/layout purchases */
  previewNote?: string
  onClose: () => void
}) {
  const [selected, setSelected] = useState(options[0]?.key ?? '')
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

  async function onCta() {
    if (!intent) {
      setTried(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const start = await startCheckout(intent, selected)
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
        <div className="purchase-options">
          {options.map((opt) => (
            <label key={opt.key} className={`purchase-option${selected === opt.key ? ' selected' : ''}`}>
              {opt.key === 'collection' && <span className="purchase-badge">Best value</span>}
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
