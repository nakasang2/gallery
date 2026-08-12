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
import { PRICE_SLOT, PRICE_ROOM, PRICE_VIDEO_PASS, paidIdsFor, priceRangeLabel, expoRunOptions, usd } from '@/lib/pricing'
import { MAX_WORKS_PER_ROOM } from '@/lib/limits'
import { EXPO_GRACE_DAYS } from '@/lib/expos'
import { LanguageSwitcher, LocaleLink } from '@/components/I18nProvider'
import { getServerT } from '@/lib/i18n/server'
import { siteUrl } from '@/lib/publicUrl'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Legal — Xibit360',
    description:
      'Seller information for Xibit360, disclosed under the Japanese Act on Specified Commercial Transactions.',
    // 言語別URLを持たない単一ページ（DECISIONS 2026-07-29）。hreflang は張らず、
    // canonical だけを自分自身に向ける。
    alternates: { canonical: `${siteUrl()}/legal` },
  }
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
          <LocaleLink href="/" className="auth-logo">XIBIT360</LocaleLink>
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
              {/* 特商法の価格表示。テーマ/間取りは1点ごとに価格を持てるので、
                  表から範囲を導出する（全部同額なら単価のまま。AGENTS.md 5.3） */}
              {/* Everything on sale has to be listed here (特商法の価格表示). The room
                  and the Video Pass were missing while both were purchasable — found
                  2026-08-09 while adding the room. When a SKU ships, it lands here. */}
              {t('legal.valPrice', {
                slot: PRICE_SLOT,
                room: PRICE_ROOM,
                video: PRICE_VIDEO_PASS,
                layout: priceRangeLabel('layout', t('lp.priceRange')),
                theme: priceRangeLabel('theme', t('lp.priceRange')),
                max: MAX_WORKS_PER_ROOM,
              })}
              {/* 有料の額縁を出したら、この開示にも値段が並ぶ（特商法の価格表示）。
                  売っていないうちは1文まるごと出さない */}
              {paidIdsFor('frame').length > 0 &&
                ' ' + t('legal.valPriceFrames', { frame: priceRangeLabel('frame', t('lp.priceRange')) })}
              {/* 合同展示の場所代（2026-08-10 から売れる状態）。会期ごとに値段が違うので
                  `expoRunOptions()` から一覧を組み立てる ＝ 会期を1つ足しても開示が漏れない。
                  1行の書式と区切りは**この節のキー**を使う。`expo.payOption`（購入ボタン用）を
                  使い回すと、あちらは11言語ぶん訳があるのにこの節は ja / en だけなので、
                  英語の開示文にドイツ語の「7 Tage」が挟まる（実測で確認・レビュー指摘） */}
              {' ' +
                t('legal.valPriceExpo', {
                  options: expoRunOptions()
                    .map((o) => t('legal.valPriceExpoItem', { days: o.days, price: usd(o.cents) }))
                    .join(t('legal.valPriceListSep')),
                })}
            </Row>
            <Row label={t('legal.rowExtra')}>{t('legal.valExtra')}</Row>
            <Row label={t('legal.rowPayMethod')}>{t('legal.valPayMethod')}</Row>
            <Row label={t('legal.rowPayTiming')}>{t('legal.valPayTiming')}</Row>
            <Row label={t('legal.rowDelivery')}>{t('legal.valDelivery', { grace: EXPO_GRACE_DAYS })}</Row>
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
          <LocaleLink href="/">{t('footer.home')}</LocaleLink>
        </footer>
      </div>
    </main>
  )
}
