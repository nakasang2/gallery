import type { Metadata, Viewport } from 'next'
import './landing.css'
import './gallery.css'
import './auth.css'

export const metadata: Metadata = {
  title: 'HAKONIWA — Your work, given space.',
  description:
    'HAKONIWA turns your portfolio into a walkable 3D exhibition. Upload your work, compose the room, and open your show to the world with a single URL.',
  openGraph: {
    title: 'HAKONIWA — Your work, given space.',
    description: 'A platform for exhibiting art as walkable 3D galleries.',
    siteName: 'HAKONIWA',
    locale: 'en_US',
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Loaded at runtime rather than via next/font because these fonts are also used for canvas textures (name plates, etc.) */}
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
