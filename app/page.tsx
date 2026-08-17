import type { Metadata } from 'next'
import Link from 'next/link'
import LandingEffects from '@/components/landing/LandingEffects'
import HeroCanvas from '@/components/landing/HeroCanvas'
import { PLAN } from '@/lib/limits'
import { PRICE_SLOT, PRICE_ROOM, PRICE_VIDEO_PASS, paidIdsFor, priceRangeLabel, expoPriceRangeLabel } from '@/lib/pricing'
import { LanguageSwitcher, LegalLink, LocaleLink } from '@/components/I18nProvider'
import { getServerT } from '@/lib/i18n/server'
import { localeAlternates } from '@/lib/i18n/metadata'

// The landing page inherits title/description from the root layout; what it needs
// of its own is the canonical + hreflang set for `/{locale}` (lib/i18n/metadata).
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT()
  const title = t('seo.homeTitle')
  const description = t('seo.homeDesc')
  // openGraph は明示的に上書きする。layout の値は自動では title から
  // 導出されないので、指定しないと共有カードだけ英語のまま残る。
  return {
    title,
    description,
    openGraph: { title, description },
    alternates: await localeAlternates('/'),
  }
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
        {/* 並びはページの並びと同じにする（features は3Dの廊下なのでヒーローの
            直後に来る）。逆にしていた頃は「コンセプト」を押すと、まだ見ていない
            features を飛び越して下へ跳んでいた */}
        <div className="nav-links">
          <a href="#features">{t('lp.navFeatures')}</a>
          <a href="#concept">{t('lp.navConcept')}</a>
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

        <div className="hero-scroll" aria-hidden="true">
          <span className="hero-scroll-label">{t('lp.heroScroll')}</span>
          <span className="hero-scroll-glyph" />
        </div>
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
          <div className="cfeat"><span className="cfeat-no">04</span><div><h3>{t('lp.f4Title')}</h3><p>{t('lp.f4Body')}</p></div></div>
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

      {/* ============ COMPARE ============ */}
      {/* 仮想敵は「会場を借りて開く個展」（ユーザー選択 2026-08-17）。**実名の競合は出さない**
          ── 景表法の比較広告は①客観的に実証された事実②正確な引用③公正な方法が要る。実名を
          出すと相手の条件が変わるたびにこちらの表示が虚偽になり、こちらで管理できない。
          **金額の行も置いていない** ── 料金はすぐ下の料金セクションが唯一の出どころで、
          ここに書くと同じ意味の値が2か所になる（【絶対ルール】2026-08-12）。
          比較データなので本物の <table> にする（読み上げが行と列の対応を伝えられる）。 */}
      <section className="compare" id="compare">
        <div className="section-head reveal">
          <p className="section-eyebrow">{t('lp.compareEyebrow')}</p>
          <h2 className="section-title">{t('lp.compareTitle')}</h2>
        </div>
        <p className="compare-lead reveal">{t('lp.compareLead')}</p>
        {/* 横送りは**この div** が受ける。`table` 自身に `overflow-x` を効かせるには
            `display: block` が要り、それをやると PC でも表としての意味が落ちて
            「どの列のどの行か」が読み上げに伝わらなくなる（別視点レビュー 2026-08-17）。 */}
        <div className="compare-scroll reveal">
        <table className="compare-table" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <td role="cell" />
              <th scope="col" role="columnheader">{t('lp.compareColA')}</th>
              {/* ブランド名なので訳さない (i18n-ok) */}
              <th scope="col" role="columnheader" className="compare-ours">Xibit360</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {([
              ['lp.compareR1', 'lp.compareR1a', 'lp.compareR1b'],
              ['lp.compareR2', 'lp.compareR2a', 'lp.compareR2b'],
              ['lp.compareR3', 'lp.compareR3a', 'lp.compareR3b'],
              ['lp.compareR4', 'lp.compareR4a', 'lp.compareR4b'],
              ['lp.compareR5', 'lp.compareR5a', 'lp.compareR5b'],
            ] as const).map(([label, a, b]) => (
              <tr key={label} role="row">
                <th scope="row" role="rowheader">{t(label)}</th>
                {/* 列の名前をセルにも持たせる。**電話では表を積み上げて見せる**ので、
                    見出し行が消えたときにどちらの話か分からなくなるのを防ぐ
                    （PC では CSS で隠す）。同じキーを2か所で呼んでいるだけなので
                    文言の出どころは1つのまま。 */}
                <td role="cell">
                  <span className="compare-cell-label">{t('lp.compareColA')}</span>
                  {t(a)}
                </td>
                <td role="cell" className="compare-ours">
                  {/* ブランド名なので訳さない (i18n-ok) */}
                  <span className="compare-cell-label">Xibit360</span>
                  {t(b)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {/* **この但し書きは削らない。** 他社の相場を数字で書いている以上、景表法7条2項
            （不実証広告規制）で根拠の提出を求められうる。根拠は docs/EVIDENCE-COMPARE.md に
            調査日・出典URL・為替まで残してある。数字を変えるときはあちらも必ず直す。 */}
        <p className="compare-note reveal">{t('lp.compareNote')}</p>
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
            {/* 売っているものは全部ここに並ぶ（ユーザー決定 2026-08-12・D-3）。部屋・
                ビデオパス・合同展示は売れる状態なのに長く載っていなかった＝見込み客が
                読む唯一のページで、単価の高い商品が見えていなかった。並びは
                「広さ → 出せるもの → 見た目 → 一緒に開く」。 */}
            <ul>
              <li>{t('lp.upSlots')}<span className="amt">{t('lp.each', { price: PRICE_SLOT })}</span></li>
              {/* 部屋は繰り返し買えるので「1つ {price}」の書式が合う */}
              <li>{t('lp.upRooms')}<span className="amt">{t('lp.each', { price: PRICE_ROOM })}</span></li>
              {/* ビデオパスは買い切りで1つだけなので「1つ」を付けず金額だけ出す */}
              <li>{t('lp.upVideo')}<span className="amt">{PRICE_VIDEO_PASS}</span></li>
              {/* One price while every theme costs the same, a range once one doesn't
                  — priceRangeLabel derives it from the price table (AGENTS.md 5.3) */}
              <li>{t('lp.upThemes')}<span className="amt">{t('lp.each', { price: priceRangeLabel('theme', t('lp.priceRange')) })}</span></li>
              <li>{t('lp.upLayouts')}<span className="amt">{t('lp.each', { price: priceRangeLabel('layout', t('lp.priceRange')) })}</span></li>
              {/* Frames only appear once one is actually on sale — every frame shipped
                  so far is free, and a price list must not advertise nothing. */}
              {paidIdsFor('frame').length > 0 && (
                <li>{t('lp.upFrames')}<span className="amt">{t('lp.each', { price: priceRangeLabel('frame', t('lp.priceRange')) })}</span></li>
              )}
              {/* 合同展示は「1つ」でも「買い切り」でもなく会期ごとの場所代。幅は
                  会期の集合から導出する（会期を足しても古い幅を名乗らない）。
                  「会期ごと」はラベル側に入れてあるので金額は幅だけ。 */}
              <li>{t('lp.upExpo')}<span className="amt">{expoPriceRangeLabel(t('lp.priceRange'))}</span></li>
            </ul>
            {billingLive ? (
              <Link className="btn btn-small price-cta" href="/me">{t('lp.buyFromGallery')}</Link>
            ) : (
              <span className="btn btn-small price-cta price-cta-soon" aria-disabled="true">{t('lp.comingSoon')}</span>
            )}
          </div>
        </div>
        {/* 表示通貨と税を金額のすぐ下に置く。lib/pricing は USD cents で、Stripe の
            Managed Payments が決済画面で税を出す（特商法ページの legal.valExtra と
            同じ事実）。既存の段落に足しているのは、.pricing-note が唯一この位置の
            スタイルを持つため（新しいクラスは check:css の視界に入らない） */}
        <p className="pricing-note reveal">
          {billingLive
            ? t('lp.pricingNoteLive')
            : t('lp.pricingNoteSoon')}{' '}
          {t('lp.pricingCurrency')}
        </p>
        {/* 買う前に出る疑問（返金・作品の権利・AI学習・容量）の答えは /help にある。
            それまでLPからは辿れず、返金の条件に至っては規約と特商法ページ ── **読む人が
            最も少ない面** ── にしか無かった。特商法の表記も、金額のすぐ下に置くのが本来
            （フッタにもあるが、LegalLink は ja のときだけ描画される）。 */}
        <p className="pricing-note reveal">
          <LocaleLink href="/help">{t('lp.pricingFaq')}</LocaleLink>
          {' · '}
          <Link href="/terms">{t('lp.pricingRefund')}</Link>
          <LegalLink before=" · " />
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
          <a href="#features">{t('lp.navFeatures')}</a>
          <a href="#concept">{t('lp.navConcept')}</a>
          <a href="#pricing">{t('lp.navPricing')}</a>
          <LocaleLink href="/demo">{t('lp.navDemo')}</LocaleLink>
          <LocaleLink href="/explore">{t('footer.explore')}</LocaleLink>
          <LocaleLink href="/articles">{t('footer.guides')}</LocaleLink>
          <LocaleLink href="/help">{t('help.title')}</LocaleLink>
          <Link href="/signin">{t('common.signIn')}</Link>
          <Link href="/signup">{t('lp.navCreateAccount')}</Link>
        </nav>
        <div className="footer-meta">
          <LanguageSwitcher />
          <Link href="/privacy">{t('footer.privacy')}</Link>
          <Link href="/terms">{t('footer.terms')}</Link>
          <LegalLink />
          {/* 通報の入口は作品ページ・作家ページ・規約・プライバシーからは辿れるが、
              サイト共通のフッタからは辿れなかった。ホスティング事業者の通報手段は
              「容易に見つけられる」ことが要る（EU DSA 16条）ので、玄関にも置く。
              ラベルは作家ページと同じキーを使い回す（新しい訳を増やさない） */}
          <Link href="/report">{t('artist.reportProblem')}</Link>
          <span>© 2026 XIBIT360</span>
        </div>
      </footer>
    </>
  )
}
