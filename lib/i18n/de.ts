// German. A partial dictionary: anything absent falls through to English
// (lib/i18n getDictionary), so this file can grow one section at a time.
//
// Addressing the reader as "du" — the English copy speaks to one artist, and
// "Sie" would make a gallery feel like a bank.
import type { PartialDictionary } from './index'

export const de: PartialDictionary = {
  common: {
    exhibition: 'Ausstellung',
    close: 'Schließen',
    cancel: 'Abbrechen',
    save: 'Speichern',
    saving: 'wird gespeichert…',
    saved: 'gespeichert',
    retry: 'Erneut versuchen',
    startFree: 'Kostenlos starten',
    signIn: 'Anmelden',
    dashboard: 'Übersicht',
    language: 'Sprache',
  },
  hud: {
    tour: 'Führung',
    endTour: 'Führung beenden',
    bgmOn: 'Musik an',
    bgmOff: 'Musik aus',
    share: 'Teilen',
    guestbook: 'Gästebuch',
    editSpace: 'Raum bearbeiten',
    others: 'Weitere Aktionen',
    closeMenu: 'Menü schließen',
    report: 'Melden',
    reportAria: 'Diese Ausstellung melden',
    record: 'Aufnehmen',
    recordAria: 'Einen Rundgang aufnehmen',
    stop: 'Stoppen',
    stopAria: 'Aufnahme stoppen',
    linkCopied: 'Link kopiert',
    yourSpace: 'Dein Raum',
    livePublished: 'öffentlich — Gespeichertes ist sofort zu sehen',
    privateDraft: 'privater Entwurf',
    yourExhibition: 'Deine Ausstellung',
    open: 'Öffnen ↗',
    houseTitle: 'XIBIT360 SAMMLUNG',
    houseSub: 'Eine ständige Sammlung — zehn Werke',
  },
  hint: {
    touch: 'Ziehen, um zu schauen · auf den Boden tippen, um zu gehen',
    drag: 'Ziehen',
    dragWhat: 'gehen und umsehen',
    tap: 'Tippen',
    tapWhat: 'Boden zum Gehen · ein Werk zum Ansehen',
    step: 'nächstes Werk',
  },
  loading: {
    nowShowing: 'Jetzt zu sehen',
    openingDoors: 'Die Türen öffnen sich…',
    preparing: 'Die Galerie wird vorbereitet…',
  },
  contextLost: {
    title: 'Der Raum hat die Verbindung zur Grafikkarte verloren.',
    body: 'Das kann passieren, wenn dem Gerät der Speicher ausgeht oder du die App wechselst.',
    rebuild: 'Raum neu aufbauen',
  },
  explore: {
    title: 'Entdecken',
    intro:
      'Alle öffentlichen Ausstellungen, zuletzt bearbeitete zuerst. Tritt ein — jeder Raum öffnet sich in 3D, direkt im Browser.',
    emptyState: 'Noch keine öffentlichen Ausstellungen — sei die erste Person hier.',
    walkThrough_one: '{count} Werk · in 3D durchgehen →',
    walkThrough_other: '{count} Werke · in 3D durchgehen →',
    loadMore: 'Mehr laden',
  },
  footer: {
    terms: 'AGB',
    privacy: 'Datenschutz',
    legal: 'Impressum',
    guides: 'Anleitungen',
    home: 'Start',
    explore: 'Entdecken',
  },
  artist: {
    exhibitions: 'Ausstellungen',
    noExhibitions: 'Noch keine öffentlichen Ausstellungen.',
    reportProblem: 'Problem melden',
  },
  catalog: {
    back: '← Zurück zur Ausstellung',
    title: 'Ausstellungskatalog',
    forSale: 'Zu kaufen',
    empty: 'Diese Ausstellung hat noch keine Werke.',
    download: 'PDF herunterladen',
  },
  notFound: {
    title: 'Dieser Raum wurde nicht gefunden.',
    lead: 'Vielleicht hat sich der Link geändert, oder die Ausstellung ist wieder privat. Der Eingang steht weiterhin offen.',
    ctaHome: 'Zurück zum Eingang',
  },
}
