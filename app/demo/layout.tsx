import type { Metadata } from 'next'
import { localeAlternates } from '@/lib/i18n/metadata'
import { getServerT } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT()
  const title = t('seo.demoTitle')
  const description = t('seo.demoDesc')
  return {
    title,
    description,
    openGraph: { title, description },
    alternates: await localeAlternates('/demo'),
  }
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
