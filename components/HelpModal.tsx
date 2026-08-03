'use client'
// The dashboard's in-place help: the same body the /help page shows, opened
// without leaving the room you are building (docs/DECISIONS 2026-08-03, option C).
//
// Follows the modal shape already in the app (PurchaseModal / ArtworkPreview3D):
// a dimmed backdrop that closes on click, Escape to close, and role="dialog" +
// aria-modal so assistive tech treats it as one. It reuses .purchase-backdrop for
// the overlay; the panel and body carry their own .help-* classes.
import { useEffect } from 'react'
import HelpContent from '@/components/HelpContent'
import { useT } from '@/components/I18nProvider'

export default function HelpModal({ onClose }: { onClose: () => void }) {
  const t = useT()
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
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('help.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="purchase-close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h1 className="help-modal-title">{t('help.title')}</h1>
        <p className="help-intro">{t('help.intro')}</p>
        <HelpContent t={t} />
      </div>
    </div>
  )
}
