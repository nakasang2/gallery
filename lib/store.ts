// Gallery settings (persisted) and UI state. Compatible with the prototype's localStorage format
// When signed in, exhibited works live in the cloud (Supabase); when signed out, they stay in localStorage as before
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { ArtworkData } from './artworks'
import {
  THEMES,
  LAYOUTS,
  FRAMES,
  HANGINGS,
  CAPTIONS,
  CUSTOM_LAYOUT_DEFAULTS,
  normalizeLayoutParams,
  type CustomLayoutParams,
} from './presets'
import { supabase } from './supabase'
import { listMyArtworks, reorderArtworks } from './cloud'
import type { PublicExhibition } from './publish'
import {
  getMyGalleryRow,
  saveGallerySpace,
  rebuildPlacements,
  type GalleryRow,
} from './galleries'

export interface AuthUser {
  id: string
  email: string | null
  displayName: string
}

export interface Settings {
  theme: string
  layout: string
  /** Knobs for layout === 'custom' (room size, centre wall) */
  layoutParams: CustomLayoutParams
  frame: string
  /** How frames are affixed to the wall (key into HANGINGS) */
  hanging: string
  /** How the name plate is shown (key into CAPTIONS) */
  caption: string
  showDemo: boolean
  artworks: ArtworkData[]
  frameOverrides: Record<string, string>
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'chic',
  layout: 'hall',
  layoutParams: CUSTOM_LAYOUT_DEFAULTS,
  frame: 'black',
  hanging: 'wire',
  caption: 'side',
  showDemo: true,
  artworks: [],
  frameOverrides: {},
}

const STORAGE_KEY = 'hakoniwa.settings.v1'
let authInitialized = false // Prevents duplicate subscriptions from React Strict Mode's double invocation
let syncTimer: ReturnType<typeof setTimeout> | null = null

// Debounced write-through: signed-in edits persist to the gallery row, and if the
// hakoniwa is public they update the placements too (decision 10.8-3: saving is live)
function scheduleGallerySync(get: () => GalleryStore) {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    const s = get()
    if (!supabase || !s.user || !s.myGallery) return
    void (async () => {
      try {
        await saveGallerySpace(s.myGallery!.id, s)
        if (s.myGallery!.is_public) await rebuildPlacements(s.myGallery!.id, s, s.cloudArtworks)
      } catch (e) {
        console.error('gallery sync failed (apply supabase/migrations up to 0005):', e)
      }
    })()
  }, 1200)
}

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings
    if (!THEMES[s.theme]) s.theme = DEFAULT_SETTINGS.theme
    if (!LAYOUTS[s.layout] && s.layout !== 'custom') s.layout = DEFAULT_SETTINGS.layout
    s.layoutParams = normalizeLayoutParams(s.layoutParams)
    if (!FRAMES[s.frame]) s.frame = DEFAULT_SETTINGS.frame
    if (!HANGINGS[s.hanging]) s.hanging = DEFAULT_SETTINGS.hanging
    if (!CAPTIONS[s.caption]) s.caption = DEFAULT_SETTINGS.caption
    return s
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(s: Settings): boolean {
  try {
    const { theme, layout, layoutParams, frame, hanging, caption, showDemo, artworks, frameOverrides } = s
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ theme, layout, layoutParams, frame, hanging, caption, showDemo, artworks, frameOverrides })
    )
    return true
  } catch {
    return false
  }
}

interface GalleryStore extends Settings {
  /** Index of the exhibit being viewed (-1 = none) */
  focusedIndex: number
  settingsOpen: boolean
  /** Visitor guestbook panel */
  guestbookOpen: boolean
  tourActive: boolean
  /** Whether fonts have loaded and settings have been restored */
  ready: boolean

  /** The signed-in user (null = guest) */
  user: AuthUser | null
  /** The signed-in user's cloud-hosted exhibited works */
  cloudArtworks: ArtworkData[]
  /** Profile username (used in the public URL; null if unset) */
  profileUsername: string | null
  /** The signed-in user's hakoniwa row (null = none created yet). DB is the source of truth */
  myGallery: GalleryRow | null
  /** Visitor mode: overridden with read-only exhibition data on public pages */
  visitor: PublicExhibition | null

  hydrate(): void
  initAuth(): void
  refreshCloudArtworks(): Promise<void>
  /** Load my gallery row and apply its space settings (signed-in editing reads from DB) */
  refreshMyGallery(): Promise<void>
  signOut(): Promise<void>
  updateSettings(partial: Partial<Settings>): void
  /** Reorder exhibited works (move the item at `from` to `to`). Guests persist locally, signed-in users to the cloud */
  reorderOwnArtworks(from: number, to: number): Promise<void>
  setFocused(i: number): void
  setSettingsOpen(open: boolean): void
  setGuestbookOpen(open: boolean): void
  setTourActive(active: boolean): void
}

export const useGallery = create<GalleryStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  focusedIndex: -1,
  settingsOpen: false,
  guestbookOpen: false,
  tourActive: false,
  ready: false,
  user: null,
  cloudArtworks: [],
  profileUsername: null,
  myGallery: null,
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
        // Signed out: back to guest mode (restore this browser's local settings)
        set({ user: null, cloudArtworks: [], myGallery: null, ...loadSettings() })
        return
      }
      const displayName =
        (u.user_metadata?.name as string | undefined) || u.email?.split('@')[0] || 'You'
      set({ user: { id: u.id, email: u.email ?? null, displayName } })
      void get().refreshCloudArtworks()
      void get().refreshMyGallery()
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
      // Works changed (upload/delete) — keep a public hakoniwa's placements in step
      if (get().myGallery) scheduleGallerySync(get)
    } catch (e) {
      console.error(e)
      alert(
        'Could not load your works from the cloud. Check that supabase/migrations/0001_init.sql has been applied.'
      )
    }
  },

  async refreshMyGallery() {
    const user = get().user
    if (!supabase || !user) return
    try {
      const row = await getMyGalleryRow(user.id)
      if (!row) {
        set({ myGallery: null })
        return
      }
      // The gallery row is the source of truth for a signed-in user's space settings
      set({
        myGallery: row,
        ...(THEMES[row.theme] ? { theme: row.theme } : {}),
        ...(LAYOUTS[row.layout] || row.layout === 'custom' ? { layout: row.layout } : {}),
        ...(row.layout === 'custom' ? { layoutParams: normalizeLayoutParams(row.layout_params) } : {}),
        ...(FRAMES[row.frame_default] ? { frame: row.frame_default } : {}),
        ...(HANGINGS[row.hanging_default] ? { hanging: row.hanging_default } : {}),
        ...(CAPTIONS[row.caption_default] ? { caption: row.caption_default } : {}),
      })
    } catch (e) {
      console.error('load my gallery failed (apply supabase/migrations up to 0005):', e)
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
    // Signed-in edits write through to the hakoniwa row (and its public page)
    if (get().user && get().myGallery) scheduleGallerySync(get)
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
        if (get().myGallery) scheduleGallerySync(get) // new order → new placements when public
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
  setGuestbookOpen(open) {
    set({ guestbookOpen: open })
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
            layoutParams: s.visitor.layoutParams,
            frame: s.visitor.frame,
            hanging: s.visitor.hanging,
            caption: s.visitor.caption,
            showDemo: false,
            artworks: EMPTY_ARTWORKS,
            frameOverrides: s.visitor.frameOverrides,
          }
        : {
            theme: s.theme,
            layout: s.layout,
            layoutParams: s.layoutParams,
            frame: s.frame,
            hanging: s.hanging,
            caption: s.caption,
            showDemo: s.showDemo,
            artworks: s.artworks,
            frameOverrides: s.frameOverrides,
          }
    )
  )
}
