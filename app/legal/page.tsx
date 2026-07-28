// 特定商取引法に基づく表記 — required in Japan for anything sold online.
// Mirrors the disclosure on the operator's other service (ktlyst.art/legal) so
// the two stay consistent. Prices come from lib/pricing rather than being typed
// in, so a price change can't leave this page quietly wrong (LESSONS 2026-07-13).
//
// Localised, unlike /terms and /privacy: this disclosure exists for Japanese
// consumers under Japanese law, so Japanese is its natural language — while an
// English rendering keeps it readable for everyone else (decision 2026-07-28,
// option B). The Terms and Privacy Policy stay English-only, with English as the
// governing version.
import type { Metadata } from 'next'
import Link from 'next/link'
import { PRICE_SLOT, PRICE_THEME, PRICE_LAYOUT } from '@/lib/pricing'
import { MAX_WORKS_PER_ROOM } from '@/lib/limits'
import { LanguageSwitcher } from '@/components/I18nProvider'
import { getServerT } from '@/lib/i18n/server'

export const metadata: Metadata = {
  title: 'Legal — Xibit360',
  description:
    'Seller information for Xibit360, disclosed under the Japanese Act on Specified Commercial Transactions.',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="legal-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export default async function LegalPage() {
  const { t } = await getServerT()
  return (
    <main className="legal-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">XIBIT360</Link>
        </div>
        <h1 className="me-h1">{t('legal.heading')}</h1>
        <div className="legal-body">
          <p>{t('legal.intro')}</p>

          <dl className="legal-table">
            <Row label={t('legal.rowService')}>Xibit360 (xibit360.art){/* i18n-ok: サービス名 */}</Row>
            <Row label={t('legal.rowOperator')}>Nakamae Yusuke{/* i18n-ok: 運営者の氏名 */}</Row>
            <Row label={t('legal.rowAddress')}>{t('legal.valAddress')}</Row>
            <Row label={t('legal.rowPhone')}>{t('legal.valPhone')}</Row>
            <Row label={t('legal.rowEmail')}>
              {/* i18n-ok: メールアドレス */}
              <a href="mailto:support@xibit360.art">support@xibit360.art</a>
            </Row>
            <Row label={t('legal.rowPrice')}>
              {t('legal.valPrice', {
                slot: PRICE_SLOT,
                layout: PRICE_LAYOUT,
                theme: PRICE_THEME,
                max: MAX_WORKS_PER_ROOM,
              })}
            </Row>
            <Row label={t('legal.rowExtra')}>{t('legal.valExtra')}</Row>
            <Row label={t('legal.rowPayMethod')}>{t('legal.valPayMethod')}</Row>
            <Row label={t('legal.rowPayTiming')}>{t('legal.valPayTiming')}</Row>
            <Row label={t('legal.rowDelivery')}>{t('legal.valDelivery')}</Row>
            <Row label={t('legal.rowReturns')}>
              {t('legal.valReturns')} <Link href="/terms">{t('footer.terms')}</Link>
            </Row>
            <Row label={t('legal.rowAge')}>
              {t('legal.valAge')} <Link href="/terms">{t('footer.terms')}</Link>
            </Row>
            <Row label={t('legal.rowSystem')}>{t('legal.valSystem')}</Row>
          </dl>
        </div>
        <footer className="artist-footer">
          <LanguageSwitcher />
          <Link href="/terms">{t('footer.terms')}</Link>
          <Link href="/privacy">{t('footer.privacy')}</Link>
          <Link href="/">{t('footer.home')}</Link>
        </footer>
      </div>
    </main>
  )
}
