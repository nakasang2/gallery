import type { Metadata } from 'next'
import Link from 'next/link'
import { LanguageSwitcher, LocaleLink } from '@/components/I18nProvider'

export const metadata: Metadata = { title: 'Terms of Service — Xibit360' }

export default function TermsPage() {
  return (
    <main className="legal-page">
      <div className="me-inner">
        <div className="me-top">
          <LocaleLink href="/" className="auth-logo">XIBIT360</LocaleLink>
        </div>
        <h1 className="me-h1">Terms of Service</h1>
        <div className="legal-body">
          <p>
            Last updated: July 28, 2026. These terms are between you and Nakamae Yusuke, the
            operator of Xibit360 (&quot;we&quot;). Our full seller details are on the{' '}
            <LocaleLink href="/legal">Legal</LocaleLink> page. Questions:{' '}
            <a href="mailto:support@xibit360.art">support@xibit360.art</a>.
          </p>

          <h2>1. The service</h2>
          <p>Xibit360 lets you upload artwork and present it as a walkable 3D gallery with a public URL. Creating, building and publishing a gallery is free. We work to keep the service available but do not promise uninterrupted uptime, and you should keep your own copies of your original files.</p>

          <h2>2. Who can use it</h2>
          <p>You must be 18 or older to create an account. If you are creating a gallery on behalf of a school, studio or organisation, you confirm you are authorised to do so.</p>

          <h2>3. Your content</h2>
          <p>You keep all rights to the works you upload. By publishing a gallery you grant us the technical permissions needed to host and display it (storage, resizing, serving to visitors) for as long as you keep it published. Deleting a work or your account ends that permission. You must own or have permission to exhibit everything you upload.</p>
          <p><strong>No AI training.</strong> We do not use your works to train AI or machine-learning models, and we do not license, sell or provide them to third parties for that purpose. The hosting permission above is strictly for showing your exhibition to your visitors.</p>

          <h2>4. Acceptable use</h2>
          <p>Do not upload content that is illegal, infringes others&apos; rights, or is intended to harass. We may remove content or suspend accounts that violate this. Anyone can report a gallery from the <Link href="/report">report page</Link>, and we review every report. If we remove your content we will tell you why and you can reply to contest it.</p>

          <h2>5. Paid upgrades, and refunds</h2>
          <p>Publishing is free. Optional upgrades — extra work slots, layouts and themes — are <strong>one-time purchases</strong>. There is no subscription, nothing renews, and nothing is charged again. Payments are handled by Stripe; we never see your card details.</p>
          <p>Because upgrades are digital and unlock the moment your payment clears, they are <strong>not refundable</strong> once unlocked, except where the law requires otherwise. When you buy, you are asked to confirm that you want immediate access and understand that this ends any statutory right to cancel that would otherwise apply — consumers in the EU and UK, please note this is the acknowledgement required for digital content supplied immediately. If you were charged and the upgrade did not unlock, write to us: we will fix it or refund you in full.</p>
          <p>Prices may change, but a change never affects something you already bought.</p>

          <h2>6. Your account, and ending it</h2>
          <p>You are responsible for your account credentials. You can delete your account at any time from the dashboard, which removes your profile, galleries and uploaded works. We may suspend or terminate accounts that violate these terms; where we can, we will tell you first.</p>

          <h2>7. Our responsibility to you</h2>
          <p>We provide the service with reasonable care and skill. Nothing in these terms limits our liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot be limited under the law that applies to you — including the consumer protections in your own country, which these terms do not take away. Subject to that, we are not liable for indirect or consequential loss, and our total liability to you is limited to the greater of the amount you have paid us in the previous twelve months or JPY 5,000.</p>

          <h2>8. Changes</h2>
          <p>We may update these terms. For changes that materially affect you we will give notice on the site before they take effect. Continuing to use Xibit360 after that means you accept the new terms.</p>

          <h2>9. Governing law</h2>
          <p>These terms are governed by the law of Japan, and the Tokyo District Court is the court of first instance for disputes. If you are a consumer, this does not deprive you of the protection of the mandatory laws of the country where you live, or of the right to bring a claim in your local courts.</p>
        </div>
        <footer className="artist-footer">
          <LanguageSwitcher />
          <Link href="/privacy">Privacy</Link>
          <LocaleLink href="/legal">Legal</LocaleLink>
          <LocaleLink href="/">Home</LocaleLink>
        </footer>
      </div>
    </main>
  )
}
