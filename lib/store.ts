// ギャラリーの設定(永続化)と UI 状態。プロトタイプの localStorage 形式と互換
// ログイン時は出展作品がクラウド(Supabase)になり、未ログインは従来どおり localStorage
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { ArtworkData } from './artworks'
import { THEMES, LAYOUTS, FRAMES } from './presets'
import { supabase } from './supabase'
import { listMyArtworks } from './cloud'
import type { PublicExhibition } from './publish'

export interface AuthUser {
  id: string
  email: string | null
  displayName: string
}

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
let authInitialized = false // React Strict Mode の二重実行で購読が重複しないように

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

  /** ログイン中のユーザー(null = ゲスト) */
  user: AuthUser | null
  /** ログインユーザーのクラウド出展作品 */
  cloudArtworks: ArtworkData[]
  /** プロフィールのユーザー名(公開URLに使う。未設定は null) */
  profileUsername: string | null
  /** 来場者モード: 公開ページでは編集不可の展示データで上書きされる */
  visitor: PublicExhibition | null

  hydrate(): void
  initAuth(): void
  refreshCloudArtworks(): Promise<void>
  signOut(): Promise<void>
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
  user: null,
  cloudArtworks: [],
  profileUsername: null,
  visitor: null,

  hydrate() {
    set({ ...loadSettings(), ready: true })
  },

  initAuth() {
    if (!supabase || authInitialized) return
    authInitialized = true
    supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user
      if (!u) {
        set({ user: null, cloudArtworks: [] })
        return
      }
      const displayName =
        (u.user_metadata?.name as string | undefined) || u.email?.split('@')[0] || 'あなた'
      set({ user: { id: u.id, email: u.email ?? null, displayName } })
      void get().refreshCloudArtworks()
    })
  },

  async refreshCloudArtworks() {
    const user = get().user
    if (!supabase || !user) return
    try {
      // 銘板の作家名にはプロフィールの表示名を使う
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('id', user.id)
        .maybeSingle()
      const artist = profile?.display_name || user.displayName
      set({ cloudArtworks: await listMyArtworks(artist), profileUsername: profile?.username ?? null })
    } catch (e) {
      console.error(e)
      alert(
        'クラウドの作品を読み込めませんでした。supabase/migrations/0001_init.sql を適用済みか確認してください。'
      )
    }
  },

  async signOut() {
    await supabase?.auth.signOut()
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

// useShallow は値を参照比較するため、毎回生成される配列を返すと無限再レンダリングになる
const EMPTY_ARTWORKS: ArtworkData[] = []

/** 有効な空間設定を浅い比較で購読する(来場者モードでは公開データが優先) */
export function useSettings(): Settings {
  return useGallery(
    useShallow((s) =>
      s.visitor
        ? {
            theme: s.visitor.theme,
            layout: s.visitor.layout,
            frame: s.visitor.frame,
            showDemo: false,
            artworks: EMPTY_ARTWORKS,
            frameOverrides: s.visitor.frameOverrides,
          }
        : {
            theme: s.theme,
            layout: s.layout,
            frame: s.frame,
            showDemo: s.showDemo,
            artworks: s.artworks,
            frameOverrides: s.frameOverrides,
          }
    )
  )
}
