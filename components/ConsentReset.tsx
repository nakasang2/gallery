'use client'
// "Change your analytics choice" — the withdrawal half of consent. GDPR art.
// 7(3) requires withdrawing to be as easy as giving, so this is one button on
// the page people actually go to when they want to change their mind.
//
// It forgets the stored answer and reloads, which brings the banner back rather
// than inventing a second, differently-worded control. The reload also matters
// technically: Consent Mode defaults are read once at bootstrap, so a fresh
// document is the honest way to start over.
import { useEffect, useState } from 'react'
import { clearConsent, gaConfigured, readConsent, type ConsentChoice } from '@/lib/analytics'
import { useT } from '@/components/I18nProvider'

export default function ConsentReset() {
  const t = useT()
  const [choice, setChoice] = useState<ConsentChoice | null | 'loading'>('loading')

  useEffect(() => {
    setChoice(readConsent())
  }, [])

  // Nothing to withdraw when analytics is off, and nothing to change until the
  // visitor has actually answered (in the regions we ask, the banner is there).
  if (!gaConfigured || choice === 'loading' || choice === null) return null

  return (
    <p className="consent-reset">
      {choice === 'granted' ? t('consent.stateOn') : t('consent.stateOff')}{' '}
      <button
        className="consent-reset-btn"
        onClick={() => {
          clearConsent()
          location.reload()
        }}
      >
        {t('consent.change')}
      </button>
    </p>
  )
}
