import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Your room | Xibit360',
  description: 'Walk your own gallery in 3D.',
  // A private, signed-in-only view of an unpublished room — keep it out of search
  // results (the public exhibition lives at /@user/slug and is indexable).
  robots: { index: false, follow: false },
}

export default function RoomLayout({ children }: { children: React.ReactNode }) {
  return children
}
