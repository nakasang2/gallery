import type { Metadata } from 'next'
import Link from 'next/link'
import ConsentReset from '@/components/ConsentReset'
import { LanguageSwitcher, LocaleLink } from '@/components/I18nProvider'

export const metadata: Metadata = { title: 'Privacy Policy — Xibit360' }

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <div className="me-inner">
        <div className="me-top">
          <LocaleLink href="/" className="auth-logo">XIBIT360</LocaleLink>
        </div>
        <h1 className="me-h1">Privacy Policy</h1>
        <div className="legal-body">
          <p>
            Last updated: July 28, 2026. The controller of your personal data is Nakamae
            Yusuke, 178-201 Bentencho, Shinjuku-ku, Tokyo, Japan — full details on the{' '}
            <Link href="/legal">Legal</Link> page. For anything in this policy, including
            the requests described in section 7, write to{' '}
            <a href="mailto:support@xibit360.art">support@xibit360.art</a>.
          </p>

          <h2>1. What we collect</h2>
          <p><strong>If you have an account:</strong> your email address, display name, and the optional username, bio, avatar and social links you add; the works you upload and their titles, captions and settings; your galleries; and a record of any upgrade you buy.</p>
          <p><strong>If you visit someone&apos;s gallery:</strong> a count that a visit happened, any hearts you leave, and the name and message you type into a guestbook if you choose to. We do not ask visitors to sign in and we do not build profiles of them.</p>
          <p><strong>Automatically:</strong> our hosting and CDN providers process technical request data, including IP addresses, to serve the site and protect it from abuse.</p>
          <p><strong>Analytics:</strong> we use Google Analytics to understand how the service is used — which pages and galleries are opened, how long a 3D room takes to load and whether it loaded at all, which works in a gallery are opened and for how long, and which buttons are used. This is measured per visit, not per person: we do not give Google your name, email address or account ID, we do not use Google Analytics for advertising, and advertising features and data sharing are turned off. In the UK, the EEA and Switzerland, analytics storage is switched off by default, so no analytics cookie is set unless you allow it.</p>
          <p>We do not use advertising trackers, and we do not sell or share this data for advertising.</p>

          <h2>2. Why we use it, and on what basis</h2>
          <p>To run the service: signing you in, storing and serving your works, rendering your public pages, and showing artists how many people visited (performance of our contract with you). To keep the service secure and lawful, and to act on reports of infringing or illegal content (our legitimate interests, and our legal obligations). To take payment for upgrades (performance of contract). Where we ask for consent — such as reading a caption aloud — you can withdraw it at any time.</p>
          <p>If you opt in — when you create your account, or later in your account settings — we send occasional product news and tips to your email address. This is based on your consent; you can withdraw it at any time by turning it off in your account settings, or with the unsubscribe link in any such email. Opting out does not affect the service messages we must send to run your account, such as sign-in links and password resets.</p>
          <p>We do not sell your data, we do not use it for third-party advertising, and we never use your uploaded works to train AI models or provide them to third parties for AI training (see the <Link href="/terms">Terms</Link>).</p>

          <h2>3. Who processes it for us</h2>
          <p>We use a small number of providers, each acting on our instructions:</p>
          <ul>
            <li><strong>Supabase</strong> — accounts, authentication and the database.</li>
            <li><strong>Cloudflare R2</strong> — storage and delivery of your uploaded files.</li>
            <li><strong>Vercel</strong> — hosting of the website itself.</li>
            <li><strong>Stripe</strong> — payment processing. Stripe collects your payment details directly; we never receive or store your card number.</li>
            <li><strong>OpenAI</strong> — if a caption is read aloud, that caption text is sent to OpenAI to generate the audio. Nothing else about you is sent, and your images are never sent.</li>
            <li><strong>Google Analytics</strong> — usage measurement, as described in section 1.</li>
          </ul>

          <h2>4. Where your data goes</h2>
          <p>These providers operate globally, so your data may be processed outside your country, including in the United States. Where data leaves the UK or the European Economic Area we rely on the transfer mechanisms our providers offer, such as the Standard Contractual Clauses.</p>

          <h2>5. What is public</h2>
          <p>Anything in a published gallery is public: the works placed in it, its title and statement, your username, display name, bio and avatar on your artist page, and any guestbook entries left on it. Published galleries are also listed on our <LocaleLink href="/explore">Explore</LocaleLink> page and can be found by search engines. Unpublished galleries and works not placed in a public gallery are not visible to others.</p>

          <h2>6. How long we keep it</h2>
          <p>Your account data and works are kept until you delete them or close your account. Deleting a work removes its files from storage and clears them from our CDN. Deleting your account removes your profile, galleries and uploaded works. Records of purchases are kept for as long as tax and accounting law requires, even after an account is closed.</p>

          <h2>7. Your rights</h2>
          <p>You can ask us to give you a copy of your data, correct it, delete it, restrict or object to how we use it, or provide it in a portable form. Most of this you can do yourself in the dashboard. For anything else, email us and we will respond within 30 days. If you are in the UK or EEA and you think we have got something wrong, you can also complain to your local data protection authority; in Japan, to the Personal Information Protection Commission.</p>

          <h2>8. Cookies and local storage</h2>
          <p>We use browser storage for your sign-in session, to remember which works you have already hearted, and — in guest mode — to hold works you are exhibiting locally before you have an account. These are necessary for the service to function.</p>
          <p>Google Analytics sets its own cookie to tell one visit apart from the next. In the UK, the EEA and Switzerland it is switched off by default and no analytics cookie is set unless you allow it — we ask with a bar at the bottom of the page, and declining is one tap, exactly like accepting. Elsewhere it is on. We set no advertising cookies anywhere.</p>
          <ConsentReset />

          <h2>9. Children</h2>
          <p>Xibit360 is for people aged 18 and over, and we do not knowingly collect data from children. If you believe a child has created an account, please tell us and we will remove it.</p>

          <h2>10. Reporting content</h2>
          <p>To report a gallery — for copyright, harassment or illegal content — use the <Link href="/report">report page</Link>. Include enough detail for us to find the work and understand the problem. We review every report and will remove content that breaks the <Link href="/terms">Terms</Link>.</p>
          <p>For a copyright report, we keep the name and contact details you give us for as long as needed to act on the report and to defend that action if it is disputed, which can be indefinitely. If we remove content because of your report, we may share your name and the contents of your report with the person whose content was removed, so they can respond to it.</p>
        </div>
        <footer className="artist-footer">
          <LanguageSwitcher />
          <Link href="/terms">Terms</Link>
          <Link href="/legal">Legal</Link>
          <LocaleLink href="/">Home</LocaleLink>
        </footer>
      </div>
    </main>
  )
}
