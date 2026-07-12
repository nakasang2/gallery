'use client'
// Tap feedback for a locked (not-yet-purchasable) theme/layout chip. Purely an
// upsell affordance for now — REQUIREMENTS.md §11.8's "tap opens single vs.
// Collection purchase" choice arrives with the Stripe integration; today it
// only says the item isn't available yet, so a 🔒 chip is never a dead end.
import { useEffect } from 'react'

export default function LockToast({ label, onClose }: { label: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3600)
    return () => clearTimeout(t)
  }, [label, onClose])

  return (
    <div className="lock-toast" role="status">
      <span>🔒 {label} isn&apos;t available yet — new themes and layouts will be purchasable individually.</span>
      <button aria-label="Dismiss" onClick={onClose}>×</button>
    </div>
  )
}
