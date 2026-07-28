// Korean. A partial dictionary: anything absent falls through to English
// (lib/i18n getDictionary), so this file can grow one section at a time.
//
// Tone follows the English and Japanese copy — a gallery, not software. Plain
// 합니다체, no exclamation marks. Most of these lines are read by an artist's
// followers, who did not come here to learn an interface.
import type { PartialDictionary } from './index'

export const ko: PartialDictionary = {
  common: {
    exhibition: '전시',
    close: '닫기',
    cancel: '취소',
    save: '저장',
    saving: '저장 중…',
    saved: '저장했습니다',
    retry: '다시 시도',
    startFree: '무료로 시작하기',
    signIn: '로그인',
    dashboard: '대시보드',
    language: '언어',
  },
  hud: {
    tour: '순서대로 보기',
    endTour: '관람 종료',
    bgmOn: '음악 켜기',
    bgmOff: '음악 끄기',
    share: '공유',
    guestbook: '방명록',
    editSpace: '공간 편집',
    others: '다른 기능',
    closeMenu: '메뉴 닫기',
    report: '신고',
    reportAria: '이 전시를 신고',
    record: '녹화',
    recordAria: '관람 영상 녹화',
    stop: '정지',
    stopAria: '녹화 정지',
    linkCopied: '링크를 복사했습니다',
    yourSpace: '내 공간',
    livePublished: '공개 중 — 저장하면 바로 반영됩니다',
    privateDraft: '비공개 초안',
    yourExhibition: '내 전시',
    open: '열기 ↗',
    houseTitle: 'XIBIT360 컬렉션',
    houseSub: '상설전 — 열 점',
  },
  hint: {
    touch: '드래그하여 둘러보고 · 바닥을 탭하여 이동',
    drag: '드래그',
    dragWhat: '걷기・방향 바꾸기',
    tap: '탭',
    tapWhat: '바닥은 이동 · 작품은 감상',
    step: '다음 작품',
  },
  loading: {
    nowShowing: '지금 전시 중',
    openingDoors: '문을 열고 있습니다…',
    preparing: '전시장을 준비하고 있습니다…',
  },
  contextLost: {
    title: '전시장이 그래픽 카드와의 연결을 잃었습니다.',
    body: '기기의 메모리가 부족하거나 다른 앱으로 전환했을 때 일어날 수 있습니다.',
    rebuild: '전시장 다시 만들기',
  },
  explore: {
    title: '전시 찾아보기',
    intro:
      '공개된 모든 전시를 최근에 편집한 순서로 보여 줍니다. 들어가 보세요 — 각 전시장은 브라우저에서 바로 3D로 열립니다.',
    emptyState: '아직 공개된 전시가 없습니다 — 첫 번째가 되어 보세요.',
    walkThrough_one: '작품 {count}점 · 3D로 걸어보기 →',
    walkThrough_other: '작품 {count}점 · 3D로 걸어보기 →',
    loadMore: '더 보기',
  },
  footer: {
    terms: '이용약관',
    privacy: '개인정보',
    legal: '사업자 정보',
    guides: '가이드',
    home: '홈',
    explore: '전시 찾아보기',
  },
  artist: {
    exhibitions: '전시',
    noExhibitions: '아직 공개된 전시가 없습니다.',
    reportProblem: '문제 신고',
  },
  catalog: {
    back: '← 전시로 돌아가기',
    title: '전시 도록',
    forSale: '구매할 수 있습니다',
    empty: '이 전시에는 아직 작품이 없습니다.',
    download: 'PDF 내려받기',
  },
  notFound: {
    title: '이 전시장을 찾을 수 없습니다.',
    lead: '링크가 바뀌었거나 전시가 비공개로 바뀌었을 수 있습니다. 입구는 그대로 열려 있습니다.',
    ctaHome: '입구로 돌아가기',
  },
}
