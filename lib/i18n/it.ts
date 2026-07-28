// Italian. A partial dictionary: anything absent falls through to English
// (lib/i18n getDictionary), so this file can grow one section at a time.
//
// Addressing the reader as "tu" — the English copy speaks to one artist.
import type { PartialDictionary } from './index'

export const it: PartialDictionary = {
  common: {
    exhibition: 'Mostra',
    close: 'Chiudi',
    cancel: 'Annulla',
    save: 'Salva',
    saving: 'salvataggio…',
    saved: 'salvato',
    retry: 'Riprova',
    startFree: 'Inizia gratis',
    signIn: 'Accedi',
    dashboard: 'Pannello',
    language: 'Lingua',
  },
  hud: {
    tour: 'Percorso guidato',
    endTour: 'Termina il percorso',
    bgmOn: 'Musica attiva',
    bgmOff: 'Musica disattivata',
    share: 'Condividi',
    guestbook: 'Libro dei visitatori',
    editSpace: 'Modifica lo spazio',
    others: 'Altre azioni',
    closeMenu: 'Chiudi il menu',
    report: 'Segnala',
    reportAria: 'Segnala questa mostra',
    record: 'Registra',
    recordAria: 'Registra una visita',
    stop: 'Ferma',
    stopAria: 'Ferma la registrazione',
    linkCopied: 'Link copiato',
    yourSpace: 'Il tuo spazio',
    livePublished: 'online — ciò che salvi si pubblica subito',
    privateDraft: 'bozza privata',
    yourExhibition: 'La tua mostra',
    open: 'Apri ↗',
    houseTitle: 'COLLEZIONE XIBIT360',
    houseSub: 'Una collezione permanente — dieci opere',
  },
  hint: {
    touch: 'Trascina per guardare · tocca il pavimento per camminare',
    drag: 'Trascina',
    dragWhat: 'camminare e girarsi',
    tap: 'Tocca',
    tapWhat: 'il pavimento per andare · un’opera per vederla',
    step: 'opera successiva',
  },
  loading: {
    nowShowing: 'In mostra',
    openingDoors: 'Si aprono le porte…',
    preparing: 'Preparazione della galleria…',
  },
  contextLost: {
    title: 'La sala ha perso il collegamento con la scheda grafica.',
    body: 'Può succedere quando il dispositivo ha poca memoria o quando cambi applicazione.',
    rebuild: 'Ricostruisci la sala',
  },
  explore: {
    title: 'Esplora',
    intro:
      'Tutte le mostre pubbliche, dalle modificate più di recente. Entra — ogni sala si apre in 3D, direttamente nel browser.',
    emptyState: 'Non ci sono ancora mostre pubbliche — sii il primo.',
    walkThrough_one: '{count} opera · attraversa in 3D →',
    walkThrough_other: '{count} opere · attraversa in 3D →',
    loadMore: 'Carica altro',
  },
  footer: {
    terms: 'Termini',
    privacy: 'Privacy',
    legal: 'Note legali',
    guides: 'Guide',
    home: 'Home',
    explore: 'Esplora',
  },
  artist: {
    exhibitions: 'Mostre',
    noExhibitions: 'Non ci sono ancora mostre pubbliche.',
    reportProblem: 'Segnala un problema',
  },
  catalog: {
    back: '← Torna alla mostra',
    title: 'Catalogo della mostra',
    forSale: 'Disponibile per l’acquisto',
    empty: 'Questa mostra non ha ancora opere.',
    download: 'Scarica il PDF',
  },
  notFound: {
    title: 'Questa sala non si trova.',
    lead: 'Il link può essere cambiato, o la mostra è tornata privata. L’ingresso è ancora aperto.',
    ctaHome: 'Torna all’ingresso',
  },
}
