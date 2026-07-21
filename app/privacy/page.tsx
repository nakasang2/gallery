import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Privacy Policy — Xibit360' }

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">XIBIT360</Link>
        </div>
        <h1 className="me-h1">Privacy Policy</h1>
        <div className="legal-body">
          <p>Last updated: July 14, 2026.</p>

          <h2>1. What we collect</h2>
          <p>Account data (email address, display name, optional bio and username), the works you upload, and gallery settings. Authentication and storage are provided by Supabase; their infrastructure processes this data on our behalf.</p>

          <h2>2. What we use it for</h2>
          <p>Operating the service: signing you in, storing and serving your works, and rendering your public pages. We do not sell your data or use it for advertising, and we never use your uploaded works to train AI models or provide them to third parties for AI training (see the Terms).</p>

          <h2>3. What is public</h2>
          <p>Anything in a published gallery is public: the works placed in it, its title and statement, and your username, display name and bio on your artist page. Unpublished galleries and works not placed in a public gallery are not visible to others.</p>

          <h2>4. Cookies and local storage</h2>
          <p>We use browser storage for your session and, in guest mode, for works you exhibit locally. No third-party advertising trackers.</p>

          <h2>5. Deletion</h2>
          <p>Deleting a work removes its files from storage. Deleting your account removes your profile, galleries and uploaded works.</p>

          <h2>6. Contact</h2>
          <p>Questions or takedown requests: use the report link on any public page.</p>
        </div>
        <footer className="artist-footer">
          <Link href="/terms">Terms</Link>
          <Link href="/">Home</Link>
        </footer>
      </div>
    </main>
  )
}
