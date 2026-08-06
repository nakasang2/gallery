'use client'
// Loads gtag.js and reports App Router navigations. Renders nothing, and renders
// nothing at all when NEXT_PUBLIC_GA_ID is unset (local dev, previews, forks).
import { useEffect } from 'react'
import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { CONSENT_DENIED_REGIONS, CONSENT_KEY, GA_ID, gaConfigured, trackPageView } from '@/lib/analytics'

// Consent Mode v2 defaults, inlined so they are queued BEFORE gtag.js loads — a
// default set after the library initialises is too late to stop the first write.
//
// The visitor's own answer wins when they have given one, and it is read from
// localStorage *here*, synchronously, rather than by the banner component after
// hydration: a returning visitor who already agreed would otherwise spend their
// first hit in cookieless mode every single visit.
//
// With no stored answer we fall back to region: EEA/UK/CH default to denied
// (the banner will ask), everywhere else to granted. Regional entries take
// precedence over the catch-all. ad_storage is denied everywhere and
// unconditionally — we run no advertising.
const ADS_DENIED = "'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied'"
const bootstrap = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
var c = null;
try { c = localStorage.getItem(${JSON.stringify(CONSENT_KEY)}); } catch (e) {}
if (c === 'granted' || c === 'denied') {
  gtag('consent','default',{'analytics_storage':c,${ADS_DENIED}});
} else {
  gtag('consent','default',{'analytics_storage':'denied',${ADS_DENIED},'region':${JSON.stringify(
    CONSENT_DENIED_REGIONS
  )},'wait_for_update':500});
  gtag('consent','default',{'analytics_storage':'granted',${ADS_DENIED}});
}
gtag('js', new Date());
gtag('config','${GA_ID}',{'send_page_view':false});
`

// Deliberately keyed on the pathname only. `useSearchParams` would force every
// page that renders this into a Suspense boundary (Next bails out of static
// rendering otherwise), and the query string is already carried by
// page_location — so a query-only change costs a report row we don't need.
function PageViews() {
  const pathname = usePathname()
  useEffect(() => {
    trackPageView(pathname)
  }, [pathname])
  return null
}

export default function Analytics() {
  if (!gaConfigured) return null
  return (
    <>
      <Script id="ga-consent-bootstrap" strategy="afterInteractive">
        {bootstrap}
      </Script>
      <Script
        id="ga-lib"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
      />
      <PageViews />
    </>
  )
}
