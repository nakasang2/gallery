'use client'
// The artist's social icon row — shown wherever their name appears in public
// (artist page, the 3D HUD) so visitors can follow them elsewhere. Known platforms
// use their official brand mark; custom "other" links use a neutral globe.
//
// A client component because the aria-label/tooltip text comes from the dictionary,
// and `useT` reads the locale the server already resolved.
import { snsUrl, type SnsLinks as SnsLinksData } from '@/lib/publish'
import { SNS_PLATFORMS, normalizeUrl } from '@/lib/sns'
import { BRAND_ICONS, GlobeIcon } from '@/components/BrandIcons'
import { useT } from '@/components/I18nProvider'

export default function SnsLinks({ sns, className }: { sns: SnsLinksData; className?: string }) {
  const t = useT()
  const items: { key: string; href: string; label: string; icon: React.ReactNode }[] = []
  for (const p of SNS_PLATFORMS) {
    const value = sns.links[p.id]
    if (!value) continue
    const Icon = BRAND_ICONS[p.id] ?? GlobeIcon
    items.push({
      key: p.id,
      href: snsUrl(p.id, value),
      // Brand name is a proper noun (i18n-ok); the template wraps it per locale
      label: t('artist.snsFollow', { platform: p.label }),
      icon: <Icon />,
    })
  }
  sns.custom.forEach((c, i) => {
    if (!c.url) return
    items.push({
      key: `custom-${i}`,
      href: normalizeUrl(c.url),
      label: c.label || t('artist.snsWebsite'),
      icon: <GlobeIcon />,
    })
  })
  if (!items.length) return null

  return (
    <span className={`sns-links${className ? ` ${className}` : ''}`}>
      {items.map((it) => (
        <a
          key={it.key}
          href={it.href}
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
