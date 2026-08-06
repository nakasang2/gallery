'use client'
// Loads gtag.js and reports App Router navigations. Renders nothing, and renders
// nothing at all when NEXT_PUBLIC_GA_ID is unset (local dev, previews, forks).
import { useEffect } from 'react'
import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { CONSENT_DENIED_REGIONS, GA_ID, gaConfigured, trackPageView } from '@/lib/analytics'

// Consent Mode v2 defaults, inlined so they are queued BEFORE gtag.js loads —
// a default set after the library initialises is too late to stop the first
// write. Regional entries take precedence over the catch-all, so EEA/UK/CH
// visitors run cookieless until something calls grantAnalyticsConsent().
// ad_storage is denied everywhere and unconditionally: we run no advertising.
const bootstrap = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{'analytics_storage':'denied','ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','region':${JSON.stringify(
  CONSENT_DENIED_REGIONS
)},'wait_for_update':500});
gtag('consent','default',{'analytics_storage':'granted','ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied'});
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
