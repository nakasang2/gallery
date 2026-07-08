// Gallery settings (persisted) and UI state. Compatible with the prototype's localStorage format
// When signed in, exhibited works live in the cloud (Supabase); when signed out, they stay in localStorage as before
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { ArtworkData } from './artworks'
import { THEMES, LAYOUTS, FRAMES } from './presets'
import { supabase } from './supabase'
import { listMyArtworks, reorderArtworks } from './cloud'
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
let authInitialized = false // Prevents duplicate subscriptions from React Strict Mode's double invocation

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
  /** Index of the exhibit being viewed (-1 = none) */
  focusedIndex: number
  settingsOpen: boolean
  tourActive: boolean
  /** Whether fonts have loaded and settings have been restored */
  ready: boolean

  /** The signed-in user (null = guest) */
  user: AuthUser | null
  /** The signed-in user's cloud-hosted exhibited works */
  cloudArtworks: ArtworkData[]
  /** Profile username (used in the public URL; null if unset) */
  profileUsername: string | null
  /** Visitor mode: overridden with read-only exhibition data on public pages */
  visitor: PublicExhibition | null

  hydrate(): void
  initAuth(): void
  refreshCloudArtworks(): Promise<void>
  signOut(): Promise<void>
  updateSettings(partial: Partial<Settings>): void
  /** Reorder exhibited works (move the item at `from` to `to`). Guests persist locally, signed-in users to the cloud */
  reorderOwnArtworks(from: number, to: number): Promise<void>
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
        (u.user_metadata?.name as string | undefined) || u.email?.split('@')[0] || 'You'
      set({ user: { id: u.id, email: u.email ?? null, displayName } })
      void get().refreshCloudArtworks()
    })
  },

  async refreshCloudArtworks() {
    const user = get().user
    if (!supabase || !user) return
    try {
      // Use the profile's display name as the artist name on name plates
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
        'Could not load your works from the cloud. Check that supabase/migrations/0001_init.sql has been applied.'
      )
    }
  },

  async signOut() {
    await supabase?.auth.signOut()
  },

  updateSettings(partial) {
    set(partial)
    if (!saveSettings(get())) {
      alert('Browser storage is full. Remove some works or try smaller images.')
    }
  },

  async reorderOwnArtworks(from, to) {
    const s = get()
    const list = s.user ? s.cloudArtworks : s.artworks
    if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    if (s.user) {
      // Update the view first, then save the order to the cloud in the background
      set({ cloudArtworks: next })
      try {
        await reorderArtworks(next.map((a) => a.id))
      } catch (e) {
        console.error(e)
        alert('Could not save the new order. Check that 0003_order_profile.sql has been applied.')
        void get().refreshCloudArtworks()
      }
    } else {
      get().updateSettings({ artworks: next })
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

// useShallow compares values by reference, so returning a freshly created array each time would cause infinite re-renders
const EMPTY_ARTWORKS: ArtworkData[] = []

/** Subscribe to the effective space settings with shallow comparison (public data takes priority in visitor mode) */
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
