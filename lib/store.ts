// ギャラリーの設定(永続化)と UI 状態。プロトタイプの localStorage 形式と互換
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { ArtworkData } from './artworks'
import { THEMES, LAYOUTS, FRAMES } from './presets'

export interface Settings {
  theme: string
  layout: string
  frame: string
  showDemo: boolean
  artworks: ArtworkData[]
  frameOverrides: Record<string, string>
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'chic',
  layout: 'hall',
  frame: 'black',
  showDemo: true,
  artworks: [],
  frameOverrides: {},
}

const STORAGE_KEY = 'hakoniwa.settings.v1'

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings
    if (!THEMES[s.theme]) s.theme = DEFAULT_SETTINGS.theme
    if (!LAYOUTS[s.layout]) s.layout = DEFAULT_SETTINGS.layout
    if (!FRAMES[s.frame]) s.frame = DEFAULT_SETTINGS.frame
    return s
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(s: Settings): boolean {
  try {
    const { theme, layout, frame, showDemo, artworks, frameOverrides } = s
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, layout, frame, showDemo, artworks, frameOverrides }))
    return true
  } catch {
    return false
  }
}

interface GalleryStore extends Settings {
  /** 鑑賞中の展示 index(-1 = なし) */
  focusedIndex: number
  settingsOpen: boolean
  tourActive: boolean
  /** フォント読み込みと設定復元が済んだか */
  ready: boolean

  hydrate(): void
  updateSettings(partial: Partial<Settings>): void
  setFocused(i: number): void
  setSettingsOpen(open: boolean): void
  setTourActive(active: boolean): void
}

export const useGallery = create<GalleryStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  focusedIndex: -1,
  settingsOpen: false,
  tourActive: false,
  ready: false,

  hydrate() {
    set({ ...loadSettings(), ready: true })
  },

  updateSettings(partial) {
    set(partial)
    if (!saveSettings(get())) {
      alert('ブラウザの保存容量を超えました。出展作品を減らすか、小さめの画像でお試しください。')
    }
  },

  setFocused(i) {
    set({ focusedIndex: i })
  },
  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },
  setTourActive(active) {
    set({ tourActive: active })
  },
}))

/** 永続化対象の設定だけを浅い比較で購読する */
export function useSettings(): Settings {
  return useGallery(
    useShallow((s) => ({
      theme: s.theme,
      layout: s.layout,
      frame: s.frame,
      showDemo: s.showDemo,
      artworks: s.artworks,
      frameOverrides: s.frameOverrides,
    }))
  )
}
