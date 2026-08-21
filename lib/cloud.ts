// Cloud exhibition (when signed in): files go to Cloudflare R2, metadata to the
// artworks table. Nothing here talks to a storage API directly any more — the
// browser asks /api/upload-url for a presigned URL and PUTs the bytes straight to
// R2, and deletions go through /api/storage/delete. That server hop is what
// enforces "you may only write into your own folder" and the plan's storage
// quota, which used to be a Supabase RLS policy plus an advisory client check.
// See docs/DECISIONS.md 2026-07-27.
import { supabase } from './supabase'
import { optionalColumnToDrop } from './insertRetry'
import type { ArtworkData, CropAlign, PurchaseLink } from './artworks'
import { loadImage, loadImageFile } from './upload'
import { publicUrl } from './publicUrl'
import { GALLERY_BGM_MAX_BYTES } from './limits'

export interface ArtworkRow {
  id: string
  owner_id: string
  storage_path: string
  width: number
  height: number
  title: string
  description: string
  year: number | null
  tags: string[]
  created_at: string
  kind?: 'image' | 'video'
  purchase_links?: PurchaseLink[] | null
  price?: string | null
  audio_url?: string | null
  width_cm?: number | null
  height_cm?: number | null
  medium?: string | null
  has_card?: boolean | null
  crop_align?: CropAlign | null
  /** 合同展示の部屋専用プールに属する作品なら、その部屋のid（migration 0061）。
   *  通常展示の共有プールの作品は null。 */
  gallery_id?: string | null
}

/** Upload purposes the server will sign for (app/api/upload-url/route.ts owns the
 *  matching key layout — a client cannot name its own path). */
type UploadPurpose =
  | 'artwork-display'
  | 'artwork-card'
  | 'artwork-thumb'
  | 'artwork-video'
  | 'avatar'
  | 'gallery-bgm'
  | 'gallery-logo'
  | 'lp-image'

interface UploadSpec {
  purpose: UploadPurpose
  /** Artwork or gallery id, for the purposes keyed by one. */
  id?: string
  /** LP hero slot, for 'lp-image'. */
  slot?: number
  body: Blob
  contentType: string
}

/**
 * Presign, then PUT. Returns the object keys in the order requested.
 *
 * All files in one call are signed together, so a batch that would breach the
 * quota is rejected before any of it uploads. The uid comes from the session
 * token server-side, which is why no ownerId is passed here.
 */
async function putFiles(specs: UploadSpec[]): Promise<string[]> {
  const { data } = await supabase!.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const res = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      files: specs.map((s) => ({
        purpose: s.purpose,
        id: s.id,
        slot: s.slot,
        contentType: s.contentType,
        size: s.body.size,
      })),
    }),
  })
  if (!res.ok) {
    // The route sends a human-readable `error` for the cases a user can act on
    // (quota reached, file too large, wrong type).
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `Upload could not start (${res.status}).`)
  }
  const { uploads } = (await res.json()) as { uploads: { key: string; url: string }[] }

  await Promise.all(
    uploads.map(async ({ url }, i) => {
      // Content-Length is set by the browser from the Blob and was signed into
      // the URL, so a mismatch here would be rejected by R2.
      let put: Response
      try {
        put = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': specs[i].contentType },
          body: specs[i].body,
        })
      } catch (e) {
        // **ここは唯一のクロスオリジン通信**（署名付きURLの相手は R2 の S3 エンドポイント。
        // 同一オリジンの `/api/upload-url` とは別）。R2 のCORSは**書き込みを自分の
        // オリジンだけに限定**しているので（DECISIONS 2026-07-27）、許可されていない
        // オリジン ── Vercel のプレビューURLなど ── から呼ぶと preflight が落ち、
        // fetch は `TypeError: Failed to fetch` を投げる。
        //
        // 素のまま見せると「Failed to fetch」だけが画面に出て**何も分からない**
        // （ユーザーがプレビュー環境で踏んだ 2026-08-09）。何が起きたかと、
        // どのオリジンを許可すればよいかを文面に入れる。
        const origin = typeof location === 'undefined' ? '(unknown)' : location.origin
        throw new Error(
          `Could not reach the storage service from ${origin}. ` +
            `If this is a preview or local build, that origin is probably not in the ` +
            `R2 bucket's CORS allow-list for PUT (writes are limited to known origins). ` +
            `Original error: ${e instanceof Error ? e.message : String(e)}`
        )
      }
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`)
    })
  )

  // The PUT above only proves R2 accepted the declared Content-Type — nothing
  // server-side has looked at the actual bytes yet, since they went straight from
  // the browser to R2 (see this function's file header). Confirm the magic bytes
  // match what the key shape claims before treating the upload as done, so our own
  // CDN domain can't be made to serve an arbitrary file behind an artwork's URL
  // (リリース前監査 #29). A failure here deletes the bad object server-side.
  const confirm = await fetch('/api/upload-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ keys: uploads.map((u) => u.key) }),
  })
  if (!confirm.ok) {
    const detail = (await confirm.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `Upload could not be verified (${confirm.status}).`)
  }

  return uploads.map((u) => u.key)
}

/** Remove one work's files. Best-effort: the DB row is already gone by the time
 *  this runs, so a failure only orphans files and must not surface as an error. */
async function deleteArtworkFiles(artworkId: string): Promise<void> {
  try {
    const { data } = await supabase!.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/storage/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ artworkId }),
    })
  } catch (e) {
    console.warn('storage cleanup failed (files orphaned):', e)
  }
}

/** @param artistName the name to credit — the ARTWORK's own owner. Callers that hold a
 *  room rather than a library must pass the work's artist, not the room owner's name:
 *  a joint exhibition hangs several people's work on one wall, and this string is what
 *  the name plate prints. */
export function rowToArtwork(row: ArtworkRow, artistName: string): ArtworkData {
  const video = row.kind === 'video'
  return {
    id: row.id,
    title: row.title,
    artist: artistName,
    ownerId: row.owner_id,
    year: row.year ?? new Date(row.created_at).getFullYear(),
    desc: row.description,
    // **架空のタグを作らない**（ユーザー指摘 2026-08-12「exhibited が表示されるが
    // どういう条件なのか意味不明」）。以前は空のときに 'Exhibited' / 'Video' を差して
    // いたが、**タグを入力するUIはアプリのどこにも無い**（DBの既定は空配列）ので、
    // 実ユーザーの作品では**必ず**この架空の語が出ていた。しかも `textures.ts` の
    // 題箋は説明文が無いときタグに落ちるため、**壁にも「Exhibited」と焼かれていた**。
    // 空なら空のまま渡す ── 表示側が「無ければ出さない」を判断する。
    tags: row.tags,
    ratio: [row.width, row.height],
    kind: video ? 'video' : 'image',
    src: publicUrl(`${row.storage_path}/${video ? 'video' : 'display.jpg'}`),
    poster: video ? publicUrl(`${row.storage_path}/thumb.jpg`) : undefined,
    // Small, always present — safe for list/grid thumbnails at any age.
    thumb: publicUrl(`${row.storage_path}/thumb.jpg`),
    // Mid-size, only for rows uploaded after migration 0032; undefined means
    // "no card.jpg on R2", so callers fall back to `src` rather than 404.
    card: video || !row.has_card ? undefined : publicUrl(`${row.storage_path}/card.jpg`),
    purchaseLinks: row.purchase_links ?? undefined,
    price: row.price ?? undefined,
    audioUrl: row.audio_url ?? undefined,
    widthCm: row.width_cm ?? undefined,
    heightCm: row.height_cm ?? undefined,
    medium: row.medium ?? undefined,
    cropAlign: row.crop_align ?? undefined,
  }
}

/** The signed-in artist's OWN library.
 *
 *  `owner_id` is not decoration: RLS on `artworks` is a UNION of "mine"
 *  (`artworks_owner_all`) and **"hanging in anyone's public gallery"**
 *  (`artworks_select_in_public_gallery`, needed so visitors can see a show). Without
 *  the filter this returned every publicly exhibited work on the platform — stamped
 *  with the VIEWER's name by `rowToArtwork` below, counted in their works badge, and
 *  draggable onto their own wall (0037 then rejects the placement, so a publish fails
 *  instead of quietly mis-crediting). Measured on a real database 2026-08-09: artist B
 *  got 2 rows, one of them artist A's. Invisible only while nobody else has published.
 *
 *  Works OTHER artists offer to a joint exhibition arrive by their own route
 *  (`lib/invites.ts`), where they keep their own artist's name. */
export async function listMyArtworks(ownerId: string, artistName: string): Promise<ArtworkData[]> {
  let q = supabase!
    .from('artworks')
    .select('*')
    .eq('owner_id', ownerId)
    .is('gallery_id', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  let { data, error } = await q
  // `gallery_id`（migration 0061）が未適用のDBでは列が無く、`.is()` の絞り込みごと
  // 落ちる。すべての既存ユーザーが使う経路なので、**列が無ければ絞らずに読む**
  // （落ちたのが「未適用」だと確実に分かるコードのときだけ）。
  if (error && (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205')) {
    ;({ data, error } = await supabase!
      .from('artworks')
      .select('*')
      .eq('owner_id', ownerId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }))
  }
  if (error) throw error
  return (data as ArtworkRow[]).map((r) => rowToArtwork(r, artistName))
}

/**
 * 合同展示の部屋専用の作品プール（migration 0061・ユーザー決定 2026-08-13）。
 *
 * 通常展示の共有プール（`listMyArtworks`、`gallery_id is null`）とは完全に別物 —
 * 部屋を合同展示に切り替えたときに口座全体のライブラリがそのまま出ると「今まで
 * 使っている設定が反映されている」ように見えて混乱するという指摘を受け、その
 * 部屋だけ0から積む専用プールにした。DB側（`enforce_artwork_pool`）が
 * `gallery_id` は「自分の合同展示の部屋」しか名乗れないことを強制する。
 *
 * `.eq('gallery_id', ...)` 未適用のDB（0061前）では列が無くクエリが丸ごと落ちるので、
 * その場合は「まだ1点も無い」と同じ扱いにする（合同展示タブ全体を落とさない）。
 */
export async function listRoomArtworks(galleryId: string, artistName: string): Promise<ArtworkData[]> {
  // **所有者では絞らない**（2026-08-14 に `ownerId` 引数を外した）。合同展示の部屋に
  // `gallery_id` を名乗れるのは**その部屋の持ち主の作品だけ**なので（migration 0061 が
  // 拒否する／0062 のSQLテストO4で実測）、部屋で絞れば所有者で絞るのと同じ集合になる。
  // 一方で所有者で絞っていると、**主催者が「準備できた」参加作家の部屋を開いたときに
  // 0点に見える** ── 0064 でRLSを開けても、クライアント側のこの条件が先に落としていた。
  // 見えてよいかどうかはRLSが決める（アプリはその答えを表示するだけ）。
  const { data, error } = await supabase!
    .from('artworks')
    .select('*')
    .eq('gallery_id', galleryId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205') return []
    throw error
  }
  return (data as ArtworkRow[]).map((r) => rowToArtwork(r, artistName))
}

/** Total bytes this user has stored, measured in R2 by the server.
 *
 *  This used to sum `artworks.bytes` here in the browser, which undercounted
 *  everything that column never sees — audio guides, BGM, avatars, logos, and the
 *  files of any work whose row was never written. Since migration 0030 the upload
 *  gate measures the bucket instead, so the meter has to read the same number or
 *  it will cheerfully show "12MB of 300MB" while uploads are being refused.
 *
 *  Throws when storage is unconfigured (501) or unreadable; /me hides the meter. */
export async function getStorageUsage(_ownerId: string): Promise<number> {
  const { data } = await supabase!.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const res = await fetch('/api/storage/usage', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Could not read storage usage (${res.status}).`)
  const { used } = (await res.json()) as { used: number }
  return used
}

// The plan quota gate (REQUIREMENTS 10.10) now lives in /api/upload-url, which
// refuses to sign an upload that wouldn't fit and returns the same message this
// used to throw. Checking it in the browser was advisory only — a crafted request
// could skip it — so it moved rather than being duplicated here.

// Insert an artworks row; if the bytes column doesn't exist yet (0006 not applied), retry without it.
//
// `bytes` is INFORMATIONAL since migration 0030 — the quota is measured in R2, not
// summed from this column. It is still written because it is a cheap per-work size
// hint, but nothing enforces it and nothing should start trusting it again.
// `gallery_id`（migration 0061）が未適用のDBに向けてコードだけ先に出ると、
// **通常の（合同展示ではない）アップロードまで巻き込んで全滅する** ── `row` には
// 常に `gallery_id: null` が入っているため。`bytes` と同じ「列が無ければ落として
// 入れ直す」作法をこの列にも適用する（列名はエラーごとに1つずつ特定して落とす —
// 一度に決め打ちで両方落とすと、本当に別の理由で失敗したときの原因が消える）。
const INSERT_OPTIONAL = ['bytes', 'gallery_id']
async function insertArtworkRow(row: Record<string, unknown>): Promise<void> {
  let current = row
  for (let attempt = 0; attempt <= INSERT_OPTIONAL.length; attempt++) {
    const { error } = await supabase!.from('artworks').insert(current)
    if (!error) return
    // 判定は lib/insertRetry（純関数・番人 `npm run check:insert-retry` が固定している）。
    // **エラーコードで「列が無い」と分かったときだけ**落とす ── メッセージに列名が
    // 出ているかだけで決めていた頃は、0061 の拒否文が `gallery_id` を含むせいで、
    // DBが正しく拒否したアップロードを共有プールへ入れ直して**成功させていた**。
    const missing = optionalColumnToDrop(error, current, INSERT_OPTIONAL)
    if (!missing) throw error
    const { [missing]: _dropped, ...rest } = current
    current = rest
  }
}

// Every upload used to run fileToDataUrl (JPEG q0.85) and then re-encode that data
// URL to JPEG q0.85 again at the SAME size — a second lossy generation that bought
// nothing. Decode once, encode once, and start from the artist's original file
// wherever we still have it.
const DISPLAY_MAX_SIDE = 1600
const DISPLAY_QUALITY = 0.92
// Browse surfaces (Explore cards, artist-page covers) render around 330x210 CSS
// px; 800 covers that on a 2x screen at roughly a quarter of display.jpg's bytes.
// Card quality can be lower than the work itself — nobody studies a thumbnail.
const CARD_MAX_SIDE = 800
const CARD_QUALITY = 0.84
const THUMB_MAX_SIDE = 400
const THUMB_QUALITY = 0.8

/** Intrinsic width of a derivative, given the original's pixel size. */
function derivedWidth(w: number, h: number, maxSide: number): number {
  const long = Math.max(w, h)
  if (!long) return 0
  return Math.max(1, Math.round(w * Math.min(1, maxSide / long)))
}

/**
 * A `srcset` over the three derivatives, so the browser picks by the pixels it
 * actually needs instead of us guessing one size for every screen.
 *
 * The `w` values are the real intrinsic widths (derived from the original pixel
 * size, and capped at scale 1 like the encoder does) — a wrong `w` is worse than
 * no srcset at all, because the browser trusts it over the rendered box.
 *
 * `maxTier` exists because the right ceiling differs by surface: browse covers
 * stop at `card`, since letting a 2x phone reach display.jpg would undo the
 * 141KB→25KB win that adding card.jpg bought (migration 0032). The non-WebGL
 * flat gallery is the only place some visitors ever see the work, so it goes to
 * `display`.
 *
 * Returns undefined when we can't be honest about the widths — videos, rows
 * uploaded before 0032 (no card.jpg), or rows with no recorded dimensions — and
 * callers keep their plain `src`.
 */
export function artworkSrcSet(art: ArtworkData, maxTier: 'card' | 'display' = 'display'): string | undefined {
  if (art.kind === 'video' || !art.card || !art.thumb) return undefined
  const [w, h] = art.ratio
  if (!w || !h) return undefined
  const tiers: [string | undefined, number][] = [
    [art.thumb, THUMB_MAX_SIDE],
    [art.card, CARD_MAX_SIDE],
  ]
  if (maxTier === 'display') tiers.push([art.src, DISPLAY_MAX_SIDE])
  const parts: string[] = []
  let last = 0
  for (const [url, maxSide] of tiers) {
    if (!url) continue
    const dw = derivedWidth(w, h, maxSide)
    // Skip duplicates: a small original hits scale 1 on every tier, and repeated
    // widths make the browser's choice arbitrary.
    if (dw <= last) continue
    parts.push(`${url} ${dw}w`)
    last = dw
  }
  return parts.length > 1 ? parts.join(', ') : undefined
}

/** Decode whatever we were handed: the original file, or a data URL for works that
 *  only ever existed as one (guest import, add-by-URL). */
function decodeSource(src: Blob | string): Promise<HTMLImageElement> {
  return typeof src === 'string' ? loadImage(src) : loadImageFile(src)
}

/** One JPEG pass from an already-decoded image, capping the long edge. */
async function encodeJpeg(
  img: HTMLImageElement,
  maxSide: number,
  quality: number
): Promise<{ blob: Blob; w: number; h: number }> {
  const sw = img.naturalWidth || img.width
  const sh = img.naturalHeight || img.height
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff' // transparent PNGs get the white the frame would show anyway
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
  )
  return { blob, w, h }
}

/** Single-size convenience wrapper (avatar, logo, LP hero, video poster). */
async function encodeUpload(
  src: Blob | string,
  maxSide: number,
  quality = DISPLAY_QUALITY
): Promise<{ blob: Blob; w: number; h: number }> {
  return encodeJpeg(await decodeSource(src), maxSide, quality)
}

export async function uploadArtwork(params: {
  ownerId: string
  /** The artist's original file. Preferred — it is the only lossless source we get. */
  file?: Blob
  /** Fallback for works that only exist as a data URL (guest import, add-by-URL). */
  dataUrl?: string
  title: string
  /** Stored as the work's aspect ratio; defaults to the encoded display size. */
  w?: number
  h?: number
  /** 合同展示の部屋専用プールへ入れるとき、その部屋のid（migration 0061）。
   *  省略時は通常展示の共有プール（`gallery_id` は null のまま）。 */
  galleryId?: string
}): Promise<void> {
  const source = params.file ?? params.dataUrl
  if (!source) throw new Error('Nothing to upload.')
  const id = crypto.randomUUID()
  const basePath = `${params.ownerId}/${id}`

  // Two sizes: a display image (long edge 1600) and a thumbnail (long edge 400)
  // (docs/ARCHITECTURE.md ch. 5) — both encoded from a single decode of the source.
  const img = await decodeSource(source)
  const display = await encodeJpeg(img, DISPLAY_MAX_SIDE, DISPLAY_QUALITY)
  const card = await encodeJpeg(img, CARD_MAX_SIDE, CARD_QUALITY)
  const thumb = await encodeJpeg(img, THUMB_MAX_SIDE, THUMB_QUALITY)

  try {
    await putFiles([
      { purpose: 'artwork-display', id, body: display.blob, contentType: 'image/jpeg' },
      { purpose: 'artwork-card', id, body: card.blob, contentType: 'image/jpeg' },
      { purpose: 'artwork-thumb', id, body: thumb.blob, contentType: 'image/jpeg' },
    ])
    await insertArtworkRow({
      id,
      owner_id: params.ownerId,
      storage_path: basePath,
      width: params.w ?? display.w,
      height: params.h ?? display.h,
      title: params.title,
      bytes: display.blob.size + card.blob.size + thumb.blob.size,
      has_card: true,
      gallery_id: params.galleryId ?? null,
    })
  } catch (error) {
    // Covers both failure points, not just the row insert: putFiles() can now also
    // reject a batch AFTER some files already landed in R2 (the /api/upload-confirm
    // step added for リリース前監査 #29 rejects one bad file but leaves the others
    // it already checked), so a failure there must clean up too, not just a failed
    // insertArtworkRow.
    await deleteArtworkFiles(id)
    throw error
  }
}

/** Video work: store the video itself plus a poster in two sizes (requires the 0002 migration) */
export async function uploadVideoArtwork(params: {
  ownerId: string
  file: File
  posterDataUrl: string
  title: string
  w: number
  h: number
  /** 合同展示の部屋専用プールへ入れるとき、その部屋のid（migration 0061）。 */
  galleryId?: string
}): Promise<void> {
  const id = crypto.randomUUID()
  const basePath = `${params.ownerId}/${id}`

  const thumb = await encodeUpload(params.posterDataUrl, THUMB_MAX_SIDE, THUMB_QUALITY)
  const contentType = params.file.type || 'video/mp4'

  try {
    await putFiles([
      { purpose: 'artwork-video', id, body: params.file, contentType },
      { purpose: 'artwork-thumb', id, body: thumb.blob, contentType: 'image/jpeg' },
    ])
    await insertArtworkRow({
      id,
      owner_id: params.ownerId,
      storage_path: basePath,
      width: params.w,
      height: params.h,
      title: params.title,
      kind: 'video',
      bytes: params.file.size + thumb.blob.size,
      gallery_id: params.galleryId ?? null,
    })
  } catch (error) {
    // See uploadArtwork's identical catch for why putFiles() is inside this
    // try too (リリース前監査 #29's upload-confirm step).
    await deleteArtworkFiles(id)
    throw error
  }
}

/** Rename a work / edit its caption (the plate text) and/or its purchase links.
 *  Shown on the name plate, the artwork panel and the public page —
 *  placements join artworks live */
export async function updateArtworkDetails(
  artworkId: string,
  fields: {
    title: string
    description: string
    purchaseLinks?: PurchaseLink[]
    price?: string | null
    widthCm?: number | null
    heightCm?: number | null
    medium?: string | null
    cropAlign?: CropAlign
  }
): Promise<void> {
  const update: Record<string, unknown> = {
    title: fields.title.trim() || 'Untitled',
    description: fields.description.trim(),
  }
  if (fields.purchaseLinks !== undefined) {
    // Keep a row once EITHER half is filled in — dropping on `!url` alone would
    // silently erase a label the artist just typed if the autosave debounce fires
    // before they get to the URL field (別視点レビュー確定 2026-08-12). Only a
    // row nobody has touched yet (both blank, from pressing "+") gets discarded.
    update.purchase_links = fields.purchaseLinks
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.label || l.url)
  }
  if (fields.price !== undefined) update.price = (fields.price ?? '').trim() || null
  if (fields.widthCm !== undefined) update.width_cm = fields.widthCm ?? null
  if (fields.heightCm !== undefined) update.height_cm = fields.heightCm ?? null
  if (fields.medium !== undefined) update.medium = (fields.medium ?? '').trim() || null
  if (fields.cropAlign !== undefined) update.crop_align = fields.cropAlign

  // Columns from later migrations (0025/0026/0054/0055). If a target DB is behind, the write
  // fails naming a missing column — drop whichever it names (or all optionals on a generic
  // schema-cache miss) and retry, so title/caption always save.
  const OPTIONAL = ['purchase_links', 'price', 'width_cm', 'height_cm', 'medium', 'crop_align']
  let { error } = await supabase!.from('artworks').update(update).eq('id', artworkId)
  while (
    error &&
    (error.code === 'PGRST204' || error.code === '42703' || OPTIONAL.some((c) => new RegExp(c).test(error!.message ?? '')))
  ) {
    const named = OPTIONAL.find((c) => new RegExp(c).test(error!.message ?? '') && c in update)
    if (named) delete update[named]
    else OPTIONAL.forEach((c) => delete update[c]) // generic miss — drop all optionals
    if (!OPTIONAL.some((c) => c in update)) {
      ;({ error } = await supabase!.from('artworks').update(update).eq('id', artworkId))
      break
    }
    ;({ error } = await supabase!.from('artworks').update(update).eq('id', artworkId))
  }
  if (error) throw error
}

/** Save the display order of works (takes an array of ids and assigns sort_order in that order) */
export async function reorderArtworks(orderedIds: string[]): Promise<void> {
  const sb = supabase!
  // Run the individual updates in parallel (at most a few dozen, so plenty light)
  const results = await Promise.all(
    orderedIds.map((id, i) => sb.from('artworks').update({ sort_order: i }).eq('id', id))
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

/** Upload/replace the profile avatar (512px JPEG at {uid}/avatar.jpg) and save its URL */
export async function uploadAvatar(ownerId: string, file: File): Promise<string> {
  const { blob } = await encodeUpload(file, 512)
  const [key] = await putFiles([{ purpose: 'avatar', body: blob, contentType: 'image/jpeg' }])
  const url = `${publicUrl(key)}?v=${Date.now()}` // cache-bust so the new face shows immediately
  const { error } = await supabase!.from('profiles').update({ avatar_url: url }).eq('id', ownerId)
  if (error) throw error
  return url
}

/** Upload a gallery's looping ambient BGM ({uid}/{galleryId}/bgm) and return its URL.
 *  Like uploadLogo it only touches storage; the caller saves the URL onto the
 *  gallery row via saveGalleryBgm. The raw file is stored as-is (no re-encode). */
export async function uploadGalleryBgm(ownerId: string, galleryId: string, file: File): Promise<string> {
  if (file.size > GALLERY_BGM_MAX_BYTES) {
    throw new Error(`BGM tracks are limited to ${Math.floor(GALLERY_BGM_MAX_BYTES / 1024 / 1024)}MB.`)
  }
  const [key] = await putFiles([
    { purpose: 'gallery-bgm', id: galleryId, body: file, contentType: file.type || 'audio/mpeg' },
  ])
  return `${publicUrl(key)}?v=${Date.now()}` // cache-bust so a replaced track plays immediately
}

/** Upload a Design Tools logo/branding mark ({uid}/{galleryId}-logo.jpg) and
 *  return its URL — the caller saves it into that gallery's design_overrides
 *  (this does not write to any table itself, unlike uploadAvatar) */
export async function uploadLogo(ownerId: string, galleryId: string, file: File): Promise<string> {
  const { blob } = await encodeUpload(file, 400)
  const [key] = await putFiles([
    { purpose: 'gallery-logo', id: galleryId, body: blob, contentType: 'image/jpeg' },
  ])
  return `${publicUrl(key)}?v=${Date.now()}` // cache-bust so a replaced logo shows immediately
}

/** Upload a landing-page hero image and return its URL + resized dimensions. Like
 *  uploadLogo it only touches storage; the admin LP editor saves the URL into
 *  site_config. The key is now a fixed, shared `_shared/lp/...` prefix, not the
 *  caller's own folder (リリース前監査 #41・2026-08-21 — the old per-account
 *  location broke every visitor's LP images if that admin's account was ever
 *  deleted), so `app/api/upload-url/route.ts`'s `lp-image` rule checks
 *  `is_admin()` itself before signing. `ownerId` below is accepted but no
 *  longer part of the key — the route ignores it.
 *
 *  The key carries a nonce (`id`, below) rather than being fixed per slot. It used
 *  to be `{uid}/lp/{slot}.jpg`, which meant uploading a replacement immediately
 *  overwrote the file the currently-published site_config still pointed at —
 *  leaving without pressing Save still changed the live LP once the CDN's edge
 *  cache for that stable URL expired (リリース前監査 #20). The URL is unique per
 *  upload now, so it needs no separate cache-busting query param, and the OLD
 *  file stays intact (and live) until `site_config`'s reference to it is
 *  actually replaced by Save. The trade is an orphaned object in R2 if the admin
 *  uploads and never saves — a storage cost, not a correctness problem (same
 *  trade already accepted for artwork/video uploads elsewhere in this file).
 *  The nonce is a uuid, same as every other purpose's `id` here — not a
 *  timestamp, which a millisecond-scale race between two uploads to the same
 *  slot could collide on. */
export async function uploadLpImage(ownerId: string, slot: number, file: File): Promise<{ url: string; w: number; h: number }> {
  const { blob, w, h } = await encodeUpload(file, 1280)
  const [key] = await putFiles([
    { purpose: 'lp-image', id: crypto.randomUUID(), slot, body: blob, contentType: 'image/jpeg' },
  ])
  return { url: publicUrl(key), w, h }
}

/** How many placements (public walls) an artwork hangs on — used for delete warnings */
export async function artworkPlacementCount(artworkId: string): Promise<number> {
  const { count, error } = await supabase!
    .from('placements')
    .select('id', { count: 'exact', head: true })
    .eq('artwork_id', artworkId)
  if (error) throw error
  return count ?? 0
}

/**
 * Delete the account and everything in it (REQUIREMENTS 10.1).
 *
 * Both halves now happen inside /api/account/delete: deleting the row invalidates
 * the user, so a follow-up request from here could no longer be authenticated to
 * clean up R2. The route keeps the original ordering — the delete_my_account RPC
 * (0007) first, so a failure leaves the account intact and retryable — and wipes
 * the whole `{uid}/` prefix afterwards, which also catches the logos, LP images,
 * guides and BGM that the old per-path list here never removed.
 */
export async function deleteMyAccount(_ownerId: string): Promise<void> {
  const sb = supabase!
  const { data } = await sb.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const res = await fetch('/api/account/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `Could not delete the account (${res.status}).`)
  }

  await sb.auth.signOut().catch(() => {}) // session is already invalid — best effort
}

export async function deleteArtwork(_ownerId: string, artworkId: string): Promise<void> {
  const { error } = await supabase!.from('artworks').delete().eq('id', artworkId)
  if (error) throw error
  // Removes the work's whole folder, so image and video layouts both get cleaned
  // up (as does an audio guide) without listing candidate paths.
  await deleteArtworkFiles(artworkId)
}
