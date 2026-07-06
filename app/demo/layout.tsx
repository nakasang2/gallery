import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'HAKONIWA COLLECTION — 常設展 | HAKONIWA',
  description: '10人の作家による常設展。ブラウザの中のギャラリーを、歩いて鑑賞できます。',
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
