// Brazilian Portuguese. A partial dictionary: anything absent falls through to
// English (lib/i18n getDictionary), so this file can grow one section at a time.
//
// Brazilian rather than European vocabulary throughout ("você", "celular",
// "baixar") — the audience this locale exists for is Brazil.
import type { PartialDictionary } from './index'

export const ptBr: PartialDictionary = {
  common: {
    exhibition: 'Exposição',
    close: 'Fechar',
    cancel: 'Cancelar',
    save: 'Salvar',
    saving: 'salvando…',
    saved: 'salvo',
    retry: 'Tentar de novo',
    startFree: 'Começar de graça',
    signIn: 'Entrar',
    dashboard: 'Painel',
    language: 'Idioma',
  },
  hud: {
    tour: 'Visita guiada',
    endTour: 'Encerrar a visita',
    bgmOn: 'Música ligada',
    bgmOff: 'Música desligada',
    share: 'Compartilhar',
    guestbook: 'Livro de visitas',
    editSpace: 'Editar o espaço',
    others: 'Mais ações',
    closeMenu: 'Fechar o menu',
    report: 'Denunciar',
    reportAria: 'Denunciar esta exposição',
    record: 'Gravar',
    recordAria: 'Gravar um percurso',
    stop: 'Parar',
    stopAria: 'Parar a gravação',
    linkCopied: 'Link copiado',
    yourSpace: 'Seu espaço',
    livePublished: 'no ar — o que você salva já aparece',
    privateDraft: 'rascunho privado',
    yourExhibition: 'Sua exposição',
    open: 'Abrir ↗',
    houseTitle: 'COLEÇÃO XIBIT360',
    houseSub: 'Uma coleção permanente — dez obras',
  },
  hint: {
    touch: 'Arraste para olhar · toque no chão para andar',
    drag: 'Arraste',
    dragWhat: 'andar e virar',
    tap: 'Toque',
    tapWhat: 'no chão para andar · numa obra para vê-la',
    step: 'próxima obra',
  },
  loading: {
    nowShowing: 'Em exibição',
    openingDoors: 'Abrindo as portas…',
    preparing: 'Preparando a galeria…',
  },
  contextLost: {
    title: 'A sala perdeu a conexão com a placa de vídeo.',
    body: 'Isso pode acontecer quando falta memória no aparelho ou quando você troca de aplicativo.',
    rebuild: 'Reconstruir a sala',
  },
  explore: {
    title: 'Explorar',
    intro:
      'Todas as exposições públicas, as editadas mais recentemente primeiro. Entre — cada sala abre em 3D, direto no navegador.',
    emptyState: 'Ainda não há exposições públicas — seja a primeira pessoa.',
    walkThrough_one: '{count} obra · percorrer em 3D →',
    walkThrough_other: '{count} obras · percorrer em 3D →',
    loadMore: 'Carregar mais',
  },
  footer: {
    terms: 'Termos',
    privacy: 'Privacidade',
    legal: 'Informações legais',
    guides: 'Guias',
    home: 'Início',
    explore: 'Explorar',
  },
  artist: {
    exhibitions: 'Exposições',
    noExhibitions: 'Ainda não há exposições públicas.',
    reportProblem: 'Relatar um problema',
  },
  catalog: {
    back: '← Voltar para a exposição',
    title: 'Catálogo da exposição',
    forSale: 'Disponível para compra',
    empty: 'Esta exposição ainda não tem obras.',
    download: 'Baixar o PDF',
  },
  notFound: {
    title: 'Não encontramos esta sala.',
    lead: 'O link pode ter mudado, ou a exposição pode ter voltado a ser privada. A entrada continua aberta.',
    ctaHome: 'Voltar para a entrada',
  },
}
