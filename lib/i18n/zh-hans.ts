// Simplified Chinese. A partial dictionary: anything absent falls through to
// English (lib/i18n getDictionary), so this file can grow one section at a time.
//
// Deliberately separate from zh-hant — the two differ well beyond character
// conversion (设置/設定, 文件/檔案, 视频/影片), and a converted file reads wrong
// to either audience.
import type { PartialDictionary } from './index'

export const zhHans: PartialDictionary = {
  common: {
    exhibition: '展览',
    close: '关闭',
    cancel: '取消',
    save: '保存',
    saving: '保存中…',
    saved: '已保存',
    retry: '重试',
    startFree: '免费开始',
    signIn: '登录',
    dashboard: '控制台',
    language: '语言',
  },
  hud: {
    tour: '导览',
    endTour: '结束导览',
    bgmOn: '开启音乐',
    bgmOff: '关闭音乐',
    share: '分享',
    guestbook: '留言簿',
    editSpace: '编辑空间',
    others: '更多操作',
    closeMenu: '关闭菜单',
    report: '举报',
    reportAria: '举报这个展览',
    record: '录制',
    recordAria: '录制观展过程',
    stop: '停止',
    stopAria: '停止录制',
    linkCopied: '链接已复制',
    yourSpace: '你的空间',
    livePublished: '已公开 — 保存后立即生效',
    privateDraft: '未公开的草稿',
    yourExhibition: '你的展览',
    open: '打开 ↗',
    houseTitle: 'XIBIT360 藏品',
    houseSub: '常设展 — 十件作品',
  },
  hint: {
    touch: '拖动环视 · 点击地面移动',
    drag: '拖动',
    dragWhat: '行走・转向',
    tap: '点击',
    tapWhat: '地面移动 · 作品观赏',
    step: '下一件',
  },
  loading: {
    nowShowing: '正在展出',
    openingDoors: '正在开门…',
    preparing: '正在准备展厅…',
  },
  contextLost: {
    title: '展厅与显卡的连接中断了。',
    body: '当设备内存不足或你切换到其他应用时，可能会发生这种情况。',
    rebuild: '重建展厅',
  },
  explore: {
    title: '浏览展览',
    intro: '平台上所有公开的展览，按最近编辑排序。走进去看看 — 每个展厅都能在浏览器里直接以 3D 打开。',
    emptyState: '还没有公开的展览 — 来做第一个。',
    walkThrough_one: '{count} 件作品 · 以 3D 走进去 →',
    walkThrough_other: '{count} 件作品 · 以 3D 走进去 →',
    loadMore: '加载更多',
  },
  footer: {
    terms: '服务条款',
    privacy: '隐私',
    legal: '经营者信息',
    guides: '指南',
    home: '首页',
    explore: '浏览展览',
  },
  artist: {
    exhibitions: '展览',
    noExhibitions: '还没有公开的展览。',
    reportProblem: '举报问题',
  },
  catalog: {
    back: '← 返回展览',
    title: '展览图录',
    forSale: '可以购买',
    empty: '这个展览还没有作品。',
    download: '下载 PDF',
  },
  notFound: {
    title: '找不到这个展厅。',
    lead: '链接可能已经变更，或者展览已改为不公开。入口仍然开着。',
    ctaHome: '返回入口',
  },
}
