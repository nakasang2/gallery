// Spanish. A partial dictionary: anything absent falls through to English
// (lib/i18n getDictionary), so this file can grow one section at a time.
//
// Neutral Latin-American/peninsular Spanish, addressing the reader as "tú" —
// the English copy speaks to one artist, not to an institution.
import type { PartialDictionary } from './index'

export const es: PartialDictionary = {
  common: {
    exhibition: 'Exposición',
    close: 'Cerrar',
    cancel: 'Cancelar',
    save: 'Guardar',
    saving: 'guardando…',
    saved: 'guardado',
    retry: 'Intentar de nuevo',
    startFree: 'Empieza gratis',
    signIn: 'Iniciar sesión',
    dashboard: 'Panel',
    language: 'Idioma',
  },
  hud: {
    tour: 'Recorrido',
    endTour: 'Terminar recorrido',
    bgmOn: 'Música activada',
    bgmOff: 'Música apagada',
    share: 'Compartir',
    guestbook: 'Libro de visitas',
    editSpace: 'Editar el espacio',
    others: 'Más acciones',
    closeMenu: 'Cerrar el menú',
    report: 'Denunciar',
    reportAria: 'Denunciar esta exposición',
    record: 'Grabar',
    recordAria: 'Grabar un recorrido',
    stop: 'Detener',
    stopAria: 'Detener la grabación',
    linkCopied: 'Enlace copiado',
    yourSpace: 'Tu espacio',
    livePublished: 'en línea — lo que guardas se publica al instante',
    privateDraft: 'borrador privado',
    yourExhibition: 'Tu exposición',
    open: 'Abrir ↗',
    houseTitle: 'COLECCIÓN XIBIT360',
    houseSub: 'Una colección permanente — diez obras',
  },
  hint: {
    touch: 'Arrastra para mirar · toca el suelo para caminar',
    drag: 'Arrastra',
    dragWhat: 'caminar y girar',
    tap: 'Toca',
    tapWhat: 'el suelo para avanzar · una obra para verla',
    step: 'siguiente obra',
  },
  loading: {
    nowShowing: 'En exhibición',
    openingDoors: 'Abriendo las puertas…',
    preparing: 'Preparando la galería…',
  },
  contextLost: {
    title: 'La sala perdió la conexión con la tarjeta gráfica.',
    body: 'Puede ocurrir cuando al dispositivo le falta memoria o cuando cambias de aplicación.',
    rebuild: 'Reconstruir la sala',
  },
  explore: {
    title: 'Explorar',
    intro:
      'Todas las exposiciones públicas, primero las editadas más recientemente. Entra — cada sala se abre en 3D, en tu propio navegador.',
    emptyState: 'Todavía no hay exposiciones públicas — sé el primero.',
    walkThrough_one: '{count} obra · recorre en 3D →',
    walkThrough_other: '{count} obras · recorre en 3D →',
    loadMore: 'Cargar más',
  },
  footer: {
    terms: 'Términos',
    privacy: 'Privacidad',
    legal: 'Aviso legal',
    guides: 'Guías',
    home: 'Inicio',
    explore: 'Explorar',
  },
  artist: {
    exhibitions: 'Exposiciones',
    noExhibitions: 'Todavía no hay exposiciones públicas.',
    reportProblem: 'Informar de un problema',
  },
  catalog: {
    back: '← Volver a la exposición',
    title: 'Catálogo de la exposición',
    forSale: 'Disponible para comprar',
    empty: 'Esta exposición aún no tiene obras.',
    download: 'Descargar el PDF',
  },
  notFound: {
    title: 'No se encuentra esta sala.',
    lead: 'Puede que el enlace haya cambiado o que la exposición haya vuelto a ser privada. La entrada sigue abierta.',
    ctaHome: 'Volver a la entrada',
  },
}
