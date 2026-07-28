// Indonesian. A partial dictionary: anything absent falls through to English
// (lib/i18n getDictionary), so this file can grow one section at a time.
//
// Everyday Indonesian rather than formal officialese — the reader is an artist,
// addressed as "kamu".
import type { PartialDictionary } from './index'

export const id: PartialDictionary = {
  common: {
    exhibition: 'Pameran',
    close: 'Tutup',
    cancel: 'Batal',
    save: 'Simpan',
    saving: 'menyimpan…',
    saved: 'tersimpan',
    retry: 'Coba lagi',
    startFree: 'Mulai gratis',
    signIn: 'Masuk',
    dashboard: 'Dasbor',
    language: 'Bahasa',
  },
  hud: {
    tour: 'Pemanduan',
    endTour: 'Akhiri pemanduan',
    bgmOn: 'Musik menyala',
    bgmOff: 'Musik mati',
    share: 'Bagikan',
    guestbook: 'Buku tamu',
    editSpace: 'Ubah ruang',
    others: 'Tindakan lain',
    closeMenu: 'Tutup menu',
    report: 'Laporkan',
    reportAria: 'Laporkan pameran ini',
    record: 'Rekam',
    recordAria: 'Rekam perjalanan di ruang',
    stop: 'Hentikan',
    stopAria: 'Hentikan perekaman',
    linkCopied: 'Tautan tersalin',
    yourSpace: 'Ruangmu',
    livePublished: 'tayang — yang kamu simpan langsung terbit',
    privateDraft: 'draf pribadi',
    yourExhibition: 'Pameranmu',
    open: 'Buka ↗',
    houseTitle: 'KOLEKSI XIBIT360',
    houseSub: 'Koleksi tetap — sepuluh karya',
  },
  hint: {
    touch: 'Geser untuk melihat sekeliling · ketuk lantai untuk berjalan',
    drag: 'Geser',
    dragWhat: 'berjalan dan berbalik',
    tap: 'Ketuk',
    tapWhat: 'lantai untuk berjalan · karya untuk melihatnya',
    step: 'karya berikutnya',
  },
  loading: {
    nowShowing: 'Sedang dipamerkan',
    openingDoors: 'Membuka pintu…',
    preparing: 'Menyiapkan galeri…',
  },
  contextLost: {
    title: 'Ruang kehilangan sambungan ke kartu grafis.',
    body: 'Ini bisa terjadi saat memori perangkat menipis atau saat kamu berpindah aplikasi.',
    rebuild: 'Bangun ulang ruang',
  },
  explore: {
    title: 'Jelajahi',
    intro:
      'Semua pameran publik, yang paling baru disunting lebih dahulu. Masuklah — setiap ruang terbuka dalam 3D, langsung di peramban.',
    emptyState: 'Belum ada pameran publik — jadilah yang pertama.',
    walkThrough_one: '{count} karya · jelajahi dalam 3D →',
    walkThrough_other: '{count} karya · jelajahi dalam 3D →',
    loadMore: 'Muat lebih banyak',
  },
  footer: {
    terms: 'Ketentuan',
    privacy: 'Privasi',
    legal: 'Informasi hukum',
    guides: 'Panduan',
    home: 'Beranda',
    explore: 'Jelajahi',
  },
  artist: {
    exhibitions: 'Pameran',
    noExhibitions: 'Belum ada pameran publik.',
    reportProblem: 'Laporkan masalah',
  },
  catalog: {
    back: '← Kembali ke pameran',
    title: 'Katalog pameran',
    forSale: 'Tersedia untuk dibeli',
    empty: 'Pameran ini belum punya karya.',
    download: 'Unduh PDF',
  },
  notFound: {
    title: 'Ruang ini tidak ditemukan.',
    lead: 'Tautannya mungkin berubah, atau pamerannya kembali dijadikan pribadi. Pintu masuk tetap terbuka.',
    ctaHome: 'Kembali ke pintu masuk',
  },
}
