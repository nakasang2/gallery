'use client'
// Analytics consent bar. Shown only where consent is actually required (the
// server decides from the request's country — see app/layout) and only until the
// visitor answers. Outside those regions analytics storage is already granted by
// default, so asking would be noise.
//
// Accept and decline are the same size, the same colour and one tap each: under
// GDPR refusing has to be as easy as agreeing, so there is no "primary" button
// here on purpose. Withdrawing later lives on the privacy page (ConsentReset).
import { useEffect, useState } from 'react'
import { gaConfigured, grantAnalyticsConsent, denyAnalyticsConsent, readConsent } from '@/lib/analytics'
import Link from 'next/link'
import { useT } from '@/components/I18nProvider'

export default function ConsentBanner({ required }: { required: boolean }) {
  const t = useT()
  // Never rendered on the server: the answer lives in localStorage, and markup
  // that depends on it would hydrate into a mismatch (and could flash a bar at
  // someone who already answered).
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!required || !gaConfigured) return
    setShow(readConsent() === null)
  }, [required])

  if (!show) return null

  const answer = (grant: boolean) => {
    if (grant) grantAnalyticsConsent()
    else denyAnalyticsConsent()
    setShow(false)
  }

  return (
    <div className="consent-bar" role="dialog" aria-live="polite" aria-label={t('consent.aria')}>
      <div className="consent-inner">
        <p className="consent-text">
          {t('consent.body')}{' '}
          {/* /privacy is not in LOCALIZED_PATHS (the legal pages are English-
              authoritative), so this is a plain Link like the site footer's. */}
          <Link className="consent-link" href="/privacy">
            {t('footer.privacy')}
          </Link>
        </p>
        <div className="consent-actions">
          <button className="consent-btn" onClick={() => answer(false)}>
            {t('consent.decline')}
          </button>
          <button className="consent-btn" onClick={() => answer(true)}>
            {t('consent.accept')}
          </button>
        </div>
      </div>
    </div>
  )
}
