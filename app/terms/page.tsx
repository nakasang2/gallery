import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Terms of Service — HAKONIWA' }

export default function TermsPage() {
  return (
    <main className="legal-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">HAKONIWA</Link>
        </div>
        <h1 className="me-h1">Terms of Service</h1>
        <div className="legal-body">
          <p>Last updated: July 9, 2026. HAKONIWA is an early-stage service; these terms are intentionally short and may change as the service grows.</p>

          <h2>1. The service</h2>
          <p>HAKONIWA lets you upload artwork and present it as a walkable 3D gallery with a public URL. The service is provided as-is, without uptime or data-durability guarantees. Export or keep originals of anything you cannot afford to lose.</p>

          <h2>2. Your content</h2>
          <p>You keep all rights to the works you upload. By publishing a gallery you grant us the technical permissions needed to host and display it (storage, resizing, serving to visitors). You must own or have permission to exhibit everything you upload.</p>

          <h2>3. Acceptable use</h2>
          <p>Do not upload content that is illegal, infringes others&apos; rights, or is intended to harass. We may remove content or suspend accounts that violate this, and will respond to legitimate takedown requests.</p>

          <h2>4. Accounts and limits</h2>
          <p>You are responsible for your account credentials. Plans include limits (galleries, works per gallery, storage) that may change with notice.</p>

          <h2>5. Termination</h2>
          <p>You can delete your account at any time, which removes your galleries and uploaded works. We may terminate accounts that violate these terms.</p>

          <h2>6. Liability</h2>
          <p>To the maximum extent permitted by law, HAKONIWA is not liable for indirect damages or loss of data arising from use of the service.</p>
        </div>
        <footer className="artist-footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/">Home</Link>
        </footer>
      </div>
    </main>
  )
}
