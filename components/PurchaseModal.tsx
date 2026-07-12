'use client'
// The tap-through from a locked theme/layout chip (REQUIREMENTS.md §11.5/§11.8's
// "tapping lets you choose a single purchase or the Collection"). No Stripe yet —
// this is an honest preview of the flow: real pricing, a real choice between
// buying the one item or the Collection, but the final action says so plainly
// rather than faking a purchase.
import { useEffect, useState } from 'react'
import type { PurchaseOption } from '@/lib/pricing'

export default function PurchaseModal({
  itemLabel,
  preview,
  options,
  onClose,
}: {
  itemLabel: string
  preview?: React.ReactNode
  options: PurchaseOption[]
  onClose: () => void
}) {
  const [selected, setSelected] = useState(options[0]?.key ?? '')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
        <h3 className="purchase-title">{itemLabel}</h3>
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
                  {opt.label} <span className="purchase-price">{opt.price}</span>
                </div>
                <div className="purchase-option-desc">{opt.description}</div>
              </div>
            </label>
          ))}
        </div>
        {tried ? (
          <p className="purchase-note purchase-note-active">
            Checkout isn&apos;t live yet — we&apos;ll email you the moment you can buy this.
          </p>
        ) : (
          <>
            <button className="btn-line purchase-cta" onClick={() => setTried(true)}>
              Continue to checkout
            </button>
            <p className="purchase-note">This is a preview of how buying a theme or layout will work.</p>
          </>
        )}
      </div>
    </div>
  )
}
