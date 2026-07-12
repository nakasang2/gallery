'use client'
// Tap feedback for a locked, not-yet-purchasable capability. Purely an upsell
// affordance for now — no payments are wired up, so a 🔒 chip is never a dead
// end, just an honest "not yet" plus what will unlock it.
import { useEffect } from 'react'

export default function LockToast({
  label,
  detail = 'new themes and layouts will be purchasable individually.',
  onClose,
}: {
  label: string
  /** What unlocks this — defaults to the theme/layout catalog copy; pass a
   *  specific one for capabilities that aren't sold per-item (e.g. Design Tools) */
  detail?: string
  onClose: () => void
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3600)
    return () => clearTimeout(t)
  }, [label, onClose])

  return (
    <div className="lock-toast" role="status">
      <span>🔒 {label} isn&apos;t available yet — {detail}</span>
      <button aria-label="Dismiss" onClick={onClose}>×</button>
    </div>
  )
}
