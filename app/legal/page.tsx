// 特定商取引法に基づく表記 — required in Japan for anything sold online.
// Mirrors the disclosure on the operator's other service (ktlyst.art/legal) so
// the two stay consistent. Prices come from lib/pricing rather than being typed
// in, so a price change can't leave this page quietly wrong (LESSONS 2026-07-13).
import type { Metadata } from 'next'
import Link from 'next/link'
import { PRICE_SLOT, PRICE_THEME, PRICE_LAYOUT } from '@/lib/pricing'
import { MAX_WORKS_PER_ROOM } from '@/lib/limits'

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

export default function LegalPage() {
  return (
    <main className="legal-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">XIBIT360</Link>
        </div>
        <h1 className="me-h1">Legal</h1>
        <div className="legal-body">
          <p>
            Seller information disclosed under the Japanese Act on Specified Commercial
            Transactions (特定商取引法に基づく表記). Last updated: July 28, 2026.
          </p>

          <dl className="legal-table">
            <Row label="Service">Xibit360 (xibit360.art)</Row>
            <Row label="Operator">Nakamae Yusuke</Row>
            <Row label="Address">178-201 Bentencho, Shinjuku-ku, Tokyo, Japan</Row>
            <Row label="Phone">
              Disclosed without delay on request — please write to the email address below.
            </Row>
            <Row label="Email">
              <a href="mailto:support@xibit360.art">support@xibit360.art</a>
            </Row>
            <Row label="Price">
              Creating an account, building a gallery and publishing it are free. Optional
              one-time upgrades: extra work slots {PRICE_SLOT} each (up to{' '}
              {MAX_WORKS_PER_ROOM} works per room), layouts {PRICE_LAYOUT} each, themes{' '}
              {PRICE_THEME} each. Prices are shown before you confirm, in the currency your
              payment provider presents.
            </Row>
            <Row label="Additional costs">
              None from us. You are responsible for your own internet connection. Any
              consumption tax or VAT is shown at checkout.
            </Row>
            <Row label="Payment method">Credit and debit cards, processed by Stripe.</Row>
            <Row label="Payment timing">At the time you confirm the purchase.</Row>
            <Row label="Delivery">
              Immediately on payment confirmation — the upgrade unlocks in your dashboard.
            </Row>
            <Row label="Returns and cancellation">
              Upgrades are digital goods delivered immediately, so they are not refundable
              once unlocked, except where the law requires otherwise. If an upgrade does not
              unlock after you were charged, write to us and we will fix it or refund you.
              See the <Link href="/terms">Terms</Link> for the full policy.
            </Row>
            <Row label="Age">
              Xibit360 is for people aged 18 and over. See the <Link href="/terms">Terms</Link>.
            </Row>
            <Row label="System requirements">
              A current version of Chrome, Safari, Edge or Firefox on desktop or mobile.
              The 3D gallery needs WebGL; where it is unavailable, exhibitions fall back to a
              flat list of works.
            </Row>
          </dl>
        </div>
        <footer className="artist-footer">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/">Home</Link>
        </footer>
      </div>
    </main>
  )
}
