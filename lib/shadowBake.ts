// The baked-wall-shadow manifest — the small record that says "this room's shadows
// are already drawn, here is the image". Shared by the API route that writes it, the
// publish read path that hands it to visitors, and the scene that consumes it.
//
// Kept free of React and of `lib/r2` so BOTH sides can import it: the route runs on
// the server with secrets, the scene runs in the browser.
//
// Why this exists at all: today every visitor's browser re-bakes the shadows on entry
// (DECISIONS 2026-08-18 ①). Baking once at publish time and saving the result means a
// visitor downloads one small image instead — and a phone that cannot bake at all
// (`QUALITY === 'low'`) finally gets the same picture as a desktop.

/** Bump when the ATLAS LAYOUT changes (tile order, tile size, channel meaning).
 *
 *  The fingerprint below only describes the COMPOSITION, so it cannot notice that the
 *  code now packs tiles differently — an old image would be read with a new formula
 *  and every work would show a neighbour's shadow. A version mismatch makes the
 *  reader ignore the manifest and re-bake instead. */
export const SHADOW_BAKE_VERSION = 1

export interface ShadowBake {
  v: number
  /** `bakeKey` verbatim (composition fingerprint). Compared as a whole string. */
  key: string
  url: string
  cols: number
  rows: number
  /** Tile edge in pixels. Stored rather than assumed so a future change is visible. */
  tile: number
  /** Artwork ids in tile order — index 0 is the bottom-left tile. */
  ids: string[]
}

/** Upper bounds for what the API will accept. Not tuning knobs: they exist so a
 *  malformed or hostile body cannot make us store something absurd. A 15-slot room
 *  needs 16 tiles at 256px = 1024x1024, which a mostly-transparent PNG compresses to
 *  well under 100KB — 512KB leaves room for a pathological composition. */
export const BAKE_MAX_BYTES = 512 * 1024
export const BAKE_MAX_TILES = 64
export const BAKE_MAX_KEY_CHARS = 8192

/** Is this a manifest we can actually read right now? Checks the shape AND that it
 *  describes the composition on screen — a stale fingerprint means the artist has
 *  changed the room since it was baked, so the image would be wrong. */
export function bakeMatches(bake: ShadowBake | null, bakeKey: string, ids: string[]): boolean {
  if (!bake || bake.v !== SHADOW_BAKE_VERSION) return false
  if (bake.key !== bakeKey) return false
  if (bake.tile <= 0 || bake.cols <= 0 || bake.rows <= 0) return false
  if (bake.cols * bake.rows > BAKE_MAX_TILES) return false
  // The ids also have to line up: `bakeKey` already encodes each work's id and slot,
  // so a mismatch here means the manifest was written by code that ordered tiles
  // differently — exactly the case `v` is for, but check rather than trust.
  if (bake.ids.length !== ids.length) return false
  return bake.ids.every((id, i) => id === ids[i])
}

/** Parse whatever came out of the `jsonb` column. Returns null for anything that is
 *  not a complete manifest, so a partially written row degrades to "bake at runtime"
 *  instead of throwing on a visitor's page. */
export function parseShadowBake(raw: unknown): ShadowBake | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (typeof b.key !== 'string' || typeof b.url !== 'string') return null
  if (typeof b.v !== 'number' || typeof b.cols !== 'number' || typeof b.rows !== 'number') return null
  if (typeof b.tile !== 'number') return null
  if (!Array.isArray(b.ids) || b.ids.some((id) => typeof id !== 'string')) return null
  return {
    v: b.v,
    key: b.key,
    url: b.url,
    cols: b.cols,
    rows: b.rows,
    tile: b.tile,
    ids: b.ids as string[],
  }
}
