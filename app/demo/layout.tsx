import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'HAKONIWA COLLECTION — Permanent Exhibition | HAKONIWA',
  description: 'A permanent collection of ten works by fictional artists. Walk the gallery inside your browser.',
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
