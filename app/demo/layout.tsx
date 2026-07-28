import type { Metadata } from 'next'
import { localeAlternates } from '@/lib/i18n/metadata'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'XIBIT360 COLLECTION — Permanent Exhibition | Xibit360',
    description:
      'A permanent collection of ten works by fictional artists. Walk the gallery inside your browser.',
    alternates: await localeAlternates('/demo'),
  }
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
