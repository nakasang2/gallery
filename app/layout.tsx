import type { Metadata, Viewport } from 'next'
import './landing.css'
import './gallery.css'

export const metadata: Metadata = {
  title: 'HAKONIWA — あなたの作品が、空間になる。',
  description:
    'HAKONIWAは、あなたのアートを3Dギャラリーとして公開できるプラットフォーム。作品をアップロードして空間に配置し、URLひとつで世界に個展を開けます。',
  openGraph: {
    title: 'HAKONIWA — あなたの作品が、空間になる。',
    description: 'アートを3Dギャラリーとして展示・公開できるプラットフォーム。',
    siteName: 'HAKONIWA',
    locale: 'ja_JP',
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* canvasテクスチャ(銘板等)にも使うため next/font ではなく実行時読み込み */}
        <link
          href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600;800&family=Zen+Kaku+Gothic+New:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
