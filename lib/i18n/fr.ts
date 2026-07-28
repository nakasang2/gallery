// French. A partial dictionary: anything absent falls through to English
// (lib/i18n getDictionary), so this file can grow one section at a time.
//
// Tone follows the English copy — a gallery, not software. Vouvoiement, no
// exclamation marks.
import type { PartialDictionary } from './index'

export const fr: PartialDictionary = {
  common: {
    exhibition: 'Exposition',
    close: 'Fermer',
    cancel: 'Annuler',
    save: 'Enregistrer',
    saving: 'enregistrement…',
    saved: 'enregistré',
    retry: 'Réessayer',
    startFree: 'Commencer gratuitement',
    signIn: 'Se connecter',
    dashboard: 'Tableau de bord',
    language: 'Langue',
  },
  hud: {
    tour: 'Visite guidée',
    endTour: 'Terminer la visite',
    bgmOn: 'Musique activée',
    bgmOff: 'Musique coupée',
    share: 'Partager',
    guestbook: "Livre d'or",
    editSpace: "Modifier l'espace",
    others: 'Autres actions',
    closeMenu: 'Fermer le menu',
    report: 'Signaler',
    reportAria: 'Signaler cette exposition',
    record: 'Enregistrer',
    recordAria: 'Enregistrer une visite',
    stop: 'Arrêter',
    stopAria: "Arrêter l'enregistrement",
    linkCopied: 'Lien copié',
    yourSpace: 'Votre espace',
    livePublished: 'en ligne — les modifications sont publiées aussitôt',
    privateDraft: 'brouillon privé',
    yourExhibition: 'Votre exposition',
    open: 'Ouvrir ↗',
    houseTitle: 'COLLECTION XIBIT360',
    houseSub: 'Une collection permanente — dix œuvres',
  },
  hint: {
    touch: 'Glissez pour regarder · touchez le sol pour avancer',
    drag: 'Glisser',
    dragWhat: 'marcher et se tourner',
    tap: 'Toucher',
    tapWhat: 'le sol pour avancer · une œuvre pour la voir',
    step: 'œuvre suivante',
  },
  loading: {
    nowShowing: "À l'affiche",
    openingDoors: 'Ouverture des portes…',
    preparing: 'Préparation de la galerie…',
  },
  contextLost: {
    title: 'La salle a perdu la connexion avec la carte graphique.',
    body: "Cela peut arriver quand l'appareil manque de mémoire ou quand vous changez d'application.",
    rebuild: 'Reconstruire la salle',
  },
  explore: {
    title: 'Explorer',
    intro:
      'Toutes les expositions publiques, les plus récemment modifiées en tête. Entrez — chaque salle s’ouvre en 3D, directement dans votre navigateur.',
    emptyState: 'Aucune exposition publique pour le moment — soyez le premier.',
    walkThrough_one: '{count} œuvre · parcourir en 3D →',
    walkThrough_other: '{count} œuvres · parcourir en 3D →',
    loadMore: 'Voir plus',
  },
  footer: {
    terms: 'Conditions',
    privacy: 'Confidentialité',
    legal: 'Mentions légales',
    guides: 'Guides',
    home: 'Accueil',
    explore: 'Explorer',
  },
  artist: {
    exhibitions: 'Expositions',
    noExhibitions: 'Aucune exposition publique pour le moment.',
    reportProblem: 'Signaler un problème',
  },
  catalog: {
    back: "← Retour à l'exposition",
    title: "Catalogue de l'exposition",
    forSale: 'Disponible à la vente',
    empty: "Cette exposition ne contient encore aucune œuvre.",
    download: 'Télécharger le PDF',
  },
  notFound: {
    title: 'Cette salle est introuvable.',
    lead: "Le lien a peut-être changé, ou l'exposition est repassée en privé. L'entrée reste ouverte.",
    ctaHome: "Revenir à l'entrée",
  },
}
