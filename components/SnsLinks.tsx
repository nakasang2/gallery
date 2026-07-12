// Small icon row for an artist's SNS handles/website — shown wherever their name
// appears in public (artist page, the 3D HUD) so visitors can follow them elsewhere.
import type { SnsLinks as SnsLinksData } from '@/lib/publish'

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.9 2.6h3.1l-6.8 7.77 8 10.63h-6.26l-4.9-6.4-5.6 6.4H3.24l7.27-8.3L2.9 2.6h6.42l4.43 5.86 5.15-5.86Zm-1.1 16.5h1.72L7.28 4.34H5.42l12.38 14.76Z"
      />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" />
      <circle cx="12" cy="12" r="4.1" />
      <circle cx="17.35" cy="6.65" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

function WebsiteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="8.8" />
      <path d="M3.2 12h17.6M12 3.2c2.4 2.4 3.7 5.6 3.7 8.8s-1.3 6.4-3.7 8.8c-2.4-2.4-3.7-5.6-3.7-8.8S9.6 5.6 12 3.2Z" />
    </svg>
  )
}

function toUrl(kind: 'x' | 'instagram' | 'website', value: string): string {
  if (kind === 'x') return `https://x.com/${value}`
  if (kind === 'instagram') return `https://instagram.com/${value}`
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

export default function SnsLinks({ sns, className }: { sns: SnsLinksData; className?: string }) {
  const items: { key: 'x' | 'instagram' | 'website'; label: string; icon: React.ReactNode }[] = []
  if (sns.x) items.push({ key: 'x', label: `@${sns.x} on X`, icon: <XIcon /> })
  if (sns.instagram) items.push({ key: 'instagram', label: `@${sns.instagram} on Instagram`, icon: <InstagramIcon /> })
  if (sns.website) items.push({ key: 'website', label: 'Website', icon: <WebsiteIcon /> })
  if (!items.length) return null

  return (
    <span className={`sns-links${className ? ` ${className}` : ''}`}>
      {items.map((it) => (
        <a
          key={it.key}
          href={toUrl(it.key, sns[it.key])}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={it.label}
          title={it.label}
        >
          {it.icon}
        </a>
      ))}
    </span>
  )
}
