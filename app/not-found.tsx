import Link from 'next/link'
import { getServerT } from '@/lib/i18n/server'

// The real 404 used to be Next.js's built-in white page. app/landing.css had
// carried a finished 404 design (.notfound*) since the first commit, but nothing
// ever rendered it, so a15237c removed it as dead CSS; this page and those rules
// come back together.
//
// Keep them together. `npm run check:css` only looks CSS → markup (it catches a
// rule whose class nobody uses), so it would NOT catch this page referencing
// classes that no longer exist — that failure ships silently as an unstyled 404.
//
// Deliberately without the landing nav and footer: .nav starts at opacity 0 and
// only appears once LandingEffects adds .scrolled past 40px of scroll, and this
// page is one viewport tall with nothing to scroll — the nav would never show up.
// The two CTAs are the whole navigation.
export default async function NotFound() {
  const { t } = await getServerT()
  return (
    <main className="notfound">
      <p className="notfound-code">{t('notFound.code')}</p>
      <h1 className="notfound-title">{t('notFound.title')}</h1>
      <p className="notfound-lead">{t('notFound.lead')}</p>
      <div className="notfound-cta">
        <Link className="btn btn-primary" href="/">
          {t('notFound.ctaHome')}
        </Link>
        <Link className="btn btn-ghost" href="/explore">
          {t('footer.explore')}
        </Link>
      </div>
    </main>
  )
}
