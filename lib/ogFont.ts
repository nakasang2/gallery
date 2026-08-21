// SERVER-ONLY: font bytes for `next/og`'s ImageResponse.
//
// The site's Japanese serif (`app/layout.tsx`'s Google Fonts <link>) is loaded as
// CSS in a browser — ImageResponse renders with Satori, which has no DOM and no
// CSS engine, so it needs the actual font FILE bytes handed to it directly. Without
// this, next/og's built-in fonts (Latin-only) silently drop every Japanese glyph in
// a work/exhibition title (リリース前監査 #16).
//
// The file itself is bundled at public/fonts/zen-old-mincho/ (SIL OFL license, see
// the OFL.txt alongside it — required for redistributing a Google Font).
import { readFile } from 'node:fs/promises'
import path from 'node:path'

let cached: Promise<ArrayBuffer> | null = null

/** Loaded once per server instance and reused — the file is ~5MB, not something to
 *  re-read from disk on every request. A failed read does NOT stay cached: the
 *  first version of this function assigned the rejecting promise itself to
 *  `cached`, which meant one bad read (a cold-start disk hiccup, a bad deploy
 *  snapshot) permanently broke every OG image on that server instance until it
 *  recycled (別視点レビューで発見・2026-08-21). */
function loadFont(): Promise<ArrayBuffer> {
  if (!cached) {
    cached = readFile(path.join(process.cwd(), 'public/fonts/zen-old-mincho/ZenOldMincho-Regular.ttf')).then(
      (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      (err) => {
        cached = null // let the NEXT call try again instead of repeating this failure forever
        throw err
      }
    )
  }
  return cached
}

/**
 * The font bytes, or `null` if they couldn't be read. Callers must treat `null`
 * as "render without the custom font" (Satori's generic serif), never as a
 * reason to fail the whole image — an OG card with the wrong typeface is a
 * cosmetic regression; an OG card that 500s is the exact "throws instead of
 * degrading" failure リリース前監査 #16 was written to fix, just moved to a new
 * cause (a missing/unreadable font file instead of a relative image URL).
 */
export async function zenOldMinchoFont(): Promise<ArrayBuffer | null> {
  try {
    return await loadFont()
  } catch (e) {
    console.error('ogFont: could not load Zen Old Mincho', e)
    return null
  }
}

/** The `fontFamily` value every OG image style must use to actually get this face —
 *  Satori matches by name against what's passed into ImageResponse's `fonts` option,
 *  not by any CSS already on the page. Falls back to a generic serif when the font
 *  bytes above are unavailable, so a missing file changes the typeface, not the
 *  outcome of the request. */
export const OG_FONT_FAMILY = 'Zen Old Mincho'
export const OG_FONT_FALLBACK_FAMILY = 'serif'
