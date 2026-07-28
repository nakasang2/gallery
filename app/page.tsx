import type { Metadata } from 'next'
import Link from 'next/link'
import LandingEffects from '@/components/landing/LandingEffects'
import HeroCanvas from '@/components/landing/HeroCanvas'
import { PLAN } from '@/lib/limits'
import { PRICE_SLOT, PRICE_THEME, PRICE_LAYOUT } from '@/lib/pricing'
import { LanguageSwitcher, LegalLink, LocaleLink } from '@/components/I18nProvider'
import { getServerT } from '@/lib/i18n/server'
import { localeAlternates } from '@/lib/i18n/metadata'

// The landing page inherits title/description from the root layout; what it needs
// of its own is the canonical + hreflang set for `/{locale}` (lib/i18n/metadata).
export async function generateMetadata(): Promise<Metadata> {
  return { alternates: await localeAlternates('/') }
}

export default async function LandingPage() {
  const { t } = await getServerT()
  // Server component, so we can tell the truth about billing instead of hard-coding
  // it: the pricing card said "Coming soon / billing is not implemented yet" long
  // after Checkout went live, and would have said it forever if nobody remembered.
  const billingLive = !!process.env.STRIPE_SECRET_KEY
  return (
    <>
      <LandingEffects />

      <nav className="nav" id="nav">
        <LocaleLink className="nav-logo" href="/">XIBIT360</LocaleLink>
        <div className="nav-links">
          <a href="#concept">{t('lp.navConcept')}</a>
          <a href="#features">{t('lp.navFeatures')}</a>
          <a href="#flow">{t('lp.navFlow')}</a>
          <a href="#pricing">{t('lp.navPricing')}</a>
          <LocaleLink href="/explore">{t('footer.explore')}</LocaleLink>
          <LocaleLink href="/articles">{t('footer.guides')}</LocaleLink>
        </div>
        <div className="nav-actions">
          <Link className="btn btn-small" href="/signin">{t('common.signIn')}</Link>
          {/* ナビ専用の短いラベル。ここは幅の予算が最も厳しく、共有の
              common.startFree（「Commencer gratuitement」等）では収まらない言語がある */}
          <Link className="btn btn-small btn-gold" href="/signup">{t('lp.navStart')}</Link>
        </div>
      </nav>

      {/* ============ HERO — immersive entry ============ */}
      <header className="hero" id="hero">
        {/* 3D非対応/モバイル時のフォールバックとしてCSSの額装壁を残す */}
        <div className="hero-floats" id="hero-floats" aria-hidden="true"></div>
        {/* 固定背景の3D美術館(グレードも内包)。ヒーロー〜廊下を通して常駐 */}
        <HeroCanvas />

        {/* 入口のミニマルなクローム(ナビはスクロールで初めて現れる) */}
        <div className="hero-chrome">
          <LocaleLink className="hero-mark" href="/">XIBIT360</LocaleLink>
          <LocaleLink className="hero-enter" href="/demo">{t('lp.heroCtaArrow')}</LocaleLink>
        </div>

        <div className="hero-lead-wrap">
          <p className="hero-eyebrow">{t('lp.heroEyebrow')}</p>
          <h1 className="hero-title">{t('lp.heroTitle')}</h1>
          <p className="hero-sub">
            {t('lp.heroSub')}
          </p>
          <LocaleLink className="hero-cta" href="/demo">{t('lp.heroCta')}</LocaleLink>
          <p className="hero-alt">
            <Link href="/signup">{t('lp.heroAlt')}</Link>
          </p>
        </div>

        <div className="hero-scroll" aria-hidden="true">{t('lp.heroScroll')}</div>
      </header>

      {/* ============ CORRIDOR — walk the hall; features hang on the 3D walls ============ */}
      {/* 3D対応時はこの区間で背景の廊下をスクロールで進む(パネルは3D側に掲示)。
          非対応/モバイルでは下の縦積みカードにフォールバックする。 */}
      <section className="corridor" id="features" aria-label={t('lp.navFeatures')}>
        <div className="corridor-cue" aria-hidden="true">
          <span className="section-eyebrow">{t('lp.navFeatures')}</span>
          <p>{t('lp.featuresCue')}</p>
        </div>
        <div className="corridor-fallback">
          <div className="section-head">
            <p className="section-eyebrow">{t('lp.navFeatures')}</p>
            <h2 className="section-title">{t('lp.featuresTitle')}</h2>
          </div>
          <div className="cfeat"><span className="cfeat-no">01</span><div><h3>{t('lp.f1Title')}</h3><p>{t('lp.f1Body')}</p></div></div>
          <div className="cfeat"><span className="cfeat-no">02</span><div><h3>{t('lp.f2Title')}</h3><p>{t('lp.f2Body')}</p></div></div>
          <div className="cfeat"><span className="cfeat-no">03</span><div><h3>{t('lp.f3Title')}</h3><p>{t('lp.f3Body')}</p></div></div>
          {/* i18n-ok: 公開URLの見本 */}
          <div className="cfeat"><span className="cfeat-no">04</span><div><h3>{t('lp.f4Title')}</h3><p><code>xibit360.art/@you</code> {t('lp.f4Body')}</p></div></div>
          <div className="cfeat"><span className="cfeat-no">05</span><div><h3>{t('lp.f5Title')}</h3><p>{t('lp.f5Body')}</p></div></div>
          <div className="cfeat"><span className="cfeat-no">06</span><div><h3>{t('lp.f6Title')}</h3><p>{t('lp.f6Body')}</p></div></div>
        </div>
      </section>

      {/* ============ MARQUEE ============ */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          <span>{t('lp.genres')}</span>
          <span>{t('lp.genres')}</span>
        </div>
      </div>

      {/* ============ CONCEPT — a moment in the walk ============ */}
      <section className="concept" id="concept">
        <div className="concept-inner">
          <p className="section-eyebrow reveal">{t('lp.navConcept')}</p>
          <h2 className="concept-statement" data-parallax="30">
            {t('lp.conceptStatement1')}<br /><em>{t('lp.conceptStatement2')}</em>
          </h2>
          <div className="concept-cols" data-parallax="-14">
            <p>
              {t('lp.conceptP1')}
            </p>
            <p>
              {t('lp.conceptP2')}
            </p>
          </div>
          <div className="concept-stats reveal">
            <div className="stat"><b>{t('lp.stat1')}</b><span>{t('lp.stat1Sub')}</span></div>
            <div className="stat"><b>{t('lp.stat2')}</b><span>{t('lp.stat2Sub')}</span></div>
            <div className="stat"><b>{t('lp.stat3')}</b><span>{t('lp.stat3Sub')}</span></div>
            <div className="stat"><b>{t('lp.stat4')}</b><span>{t('lp.stat4Sub')}</span></div>
          </div>
        </div>
      </section>

      {/* ============ FLOW ============ */}
      <section className="flow" id="flow">
        <div className="section-head reveal">
          <p className="section-eyebrow">{t('lp.navFlow')}</p>
          <h2 className="section-title">{t('lp.flowTitle')}</h2>
        </div>
        <ol className="flow-steps">
          <li className="reveal">
            <span className="flow-no">01</span>
            <h3>{t('lp.step1Title')}</h3>
            <p>{t('lp.step1Body')}</p>
          </li>
          <li className="reveal">
            <span className="flow-no">02</span>
            <h3>{t('lp.step2Title')}</h3>
            <p>{t('lp.step2Body')}</p>
          </li>
          <li className="reveal">
            <span className="flow-no">03</span>
            <h3>{t('lp.step3Title')}</h3>
            <p>{t('lp.step3Body')}</p>
          </li>
        </ol>
      </section>

      {/* ============ DEMO ============ */}
      <section className="demo reveal" id="demo">
        <div className="demo-card">
          <div className="demo-art" id="demo-art" data-parallax="40" aria-hidden="true"></div>
          <div className="demo-body">
            <p className="section-eyebrow">{t('lp.demoEyebrow')}</p>
            <h2 className="section-title">{t('lp.demoTitle1')}<br />{t('lp.demoTitle2')}</h2>
            <p>
              {t('lp.demoBody')}
            </p>
            <LocaleLink className="btn btn-primary" href="/demo">{t('lp.demoCta')}</LocaleLink>
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section className="pricing" id="pricing">
        <div className="section-head reveal">
          <p className="section-eyebrow">{t('lp.navPricing')}</p>
          <h2 className="section-title">{t('lp.pricingTitle')}</h2>
        </div>
        <div className="pricing-grid">
          <div className="price-card reveal">
            <h3>{t('lp.freePlan')}</h3>
            <div className="price"><b>{t('lp.freePrice')}</b><span>{t('lp.freeForever')}</span></div>
            <ul>
              <li>{t('lp.free1')}</li>
              <li>{t('lp.free2', { count: PLAN.worksPerGallery })}</li>
              <li>{t('lp.free3')}</li>
              <li>{t('lp.free4')}</li>
              <li>{t('lp.free5')}</li>
              <li>{t('lp.free6')}</li>
              <li>{t('lp.free7')}</li>
            </ul>
            <Link className="btn btn-small price-cta" href="/signup">{t('common.startFree')}</Link>
          </div>
          <div className="price-card price-card--pro reveal">
            <div className="price-badge">{t('lp.upgradesBadge')}</div>
            <h3>{t('lp.upgradesTitle')}</h3>
            <div className="price"><b>{t('lp.upgradesPrice')}</b><span>{t('lp.upgradesNoSub')}</span></div>
            <ul>
              <li>{t('lp.upSlots')}<span className="amt">{t('lp.each', { price: PRICE_SLOT })}</span></li>
              <li>{t('lp.upThemes')}<span className="amt">{t('lp.each', { price: PRICE_THEME })}</span></li>
              <li>{t('lp.upLayouts')}<span className="amt">{t('lp.each', { price: PRICE_LAYOUT })}</span></li>
            </ul>
            {billingLive ? (
              <Link className="btn btn-small price-cta" href="/me">{t('lp.buyFromGallery')}</Link>
            ) : (
              <span className="btn btn-small price-cta price-cta-soon" aria-disabled="true">{t('lp.comingSoon')}</span>
            )}
          </div>
        </div>
        <p className="pricing-note reveal">
          {billingLive
            ? t('lp.pricingNoteLive')
            : t('lp.pricingNoteSoon')}
        </p>
      </section>

      {/* ============ CLOSING — the invitation ============ */}
      <section className="closing" id="closing">
        <div className="closing-inner reveal">
          <p className="section-eyebrow">{t('lp.closingEyebrow')}</p>
          <h2 className="closing-title">{t('lp.closingTitle1')}<br /><em>{t('lp.closingTitle2')}</em></h2>
          <p className="closing-sub">
            {t('lp.closingSub')}
          </p>
          <Link className="hero-cta" href="/signup">{t('lp.closingCta')}</Link>
          <p className="closing-alt">
            <LocaleLink href="/demo">{t('lp.closingAlt')}</LocaleLink>
          </p>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="footer">
        <div className="footer-logo">XIBIT360</div>
        <p>{t('lp.footerTagline')}</p>
        <nav className="footer-links" aria-label={t('lp.footerNav')}>
          <a href="#concept">{t('lp.navConcept')}</a>
          <a href="#features">{t('lp.navFeatures')}</a>
          <a href="#pricing">{t('lp.navPricing')}</a>
          <LocaleLink href="/demo">{t('lp.navDemo')}</LocaleLink>
          <LocaleLink href="/explore">{t('footer.explore')}</LocaleLink>
          <LocaleLink href="/articles">{t('footer.guides')}</LocaleLink>
          <Link href="/signin">{t('common.signIn')}</Link>
          <Link href="/signup">{t('lp.navCreateAccount')}</Link>
        </nav>
        <div className="footer-meta">
          <LanguageSwitcher />
          <Link href="/privacy">{t('footer.privacy')}</Link>
          <Link href="/terms">{t('footer.terms')}</Link>
          <LegalLink />
          <span>© 2026 XIBIT360</span>
        </div>
      </footer>
    </>
  )
}
