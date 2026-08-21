// POST /api/upload-confirm — verify that a file just PUT to R2 actually contains
// what its key shape claims (リリース前監査 #29・2026-08-21).
//
// /api/upload-url only ever checked the CLIENT-DECLARED Content-Type, because the
// bytes go straight from the browser to R2 (see that route's own comment) — this
// server never saw them. A page renamed to display.jpg would upload untouched, and
// our own CDN domain would serve it back with whatever Content-Type the browser
// declares next time, which browsers sniff rather than trust. This route reads the
// first bytes of each object we just signed for and rejects (deleting the object)
// anything whose magic bytes don't match its key's expected kind.
//
// Called by lib/cloud.ts putFiles() immediately after every PUT succeeds, for every
// upload purpose (artwork images/video, avatar, gallery bgm/logo, lp-image) — the
// key SHAPE tells us what kind of file it is meant to be; no client input decides
// that here.
import { NextRequest, NextResponse } from 'next/server'
import { r2Configured, readObjectHead, deleteObjects } from '@/lib/r2'
import { authenticate } from '@/lib/apiAuth'

export const runtime = 'nodejs'

// Matches the batch cap in /api/upload-url (reserve_storage guards the same number).
const MAX_KEYS = 4

type Kind = 'jpeg' | 'container' | 'audio'

/** Classify by key SHAPE, mirroring the RULES table in /api/upload-url/route.ts.
 *  Unknown shapes return null and are skipped rather than rejected — a key this
 *  route doesn't recognise is not proof of anything, and failing closed here would
 *  make every future upload purpose need a matching update in two places. */
function classify(key: string): Kind | null {
  if (key.endsWith('/video')) return 'container' // artwork-video: mp4/mov (ISO BMFF)
  if (key.endsWith('/bgm')) return 'audio' // gallery-bgm: mp3 or m4a
  if (key.endsWith('.jpg')) return 'jpeg' // every other purpose signs a .jpg key
  return null
}

function isJpeg(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
}

/** ISO base media file format (mp4/mov/m4a all share this box layout): a 4-byte
 *  size field, then the literal ASCII "ftyp" at offset 4. */
function isIsoBmff(b: Buffer): boolean {
  return b.length >= 8 && b.subarray(4, 8).toString('ascii') === 'ftyp'
}

/** EBML (Matroska/WebM) — starts with the fixed 4-byte ID 0x1A45DFA3. `RULES.video`
 *  in /api/upload-url accepts any `video/*` content type, not just mp4/mov, so a
 *  screen-recorded .webm (a very plausible artist upload) must pass here too. */
function isEbml(b: Buffer): boolean {
  return b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
}

function isVideoContainer(b: Buffer): boolean {
  return isIsoBmff(b) || isEbml(b)
}

/** `RULES.audio` in /api/upload-url deliberately accepts any `audio/*` content
 *  type (browsers disagree about .m4a/.mp3 mime types — see that route's
 *  comment), so this recognizes every common container an `accept="audio/*"`
 *  picker can hand back, not just the two formats the product advertises. */
function isAudio(b: Buffer): boolean {
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true // "ID3" tag (mp3)
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true // raw MPEG frame sync (mp3)
  if (b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE') return true // .wav
  if (b.length >= 4 && b.subarray(0, 4).toString('ascii') === 'OggS') return true // .ogg
  return isIsoBmff(b) // m4a
}

function matches(kind: Kind, bytes: Buffer): boolean {
  if (kind === 'jpeg') return isJpeg(bytes)
  if (kind === 'container') return isVideoContainer(bytes)
  return isAudio(bytes)
}

export async function POST(req: NextRequest) {
  if (!r2Configured) return NextResponse.json({ error: 'Storage is not configured.' }, { status: 501 })

  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  let body: { keys?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string') : []
  if (!keys.length || keys.length > MAX_KEYS) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  // Every key must be the caller's own — this route can delete objects, and a key
  // signed for one uid must never let another uid trigger reads/deletes on it.
  const prefix = `${auth.uid}/`
  if (!keys.every((k) => k.startsWith(prefix))) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const checks = await Promise.all(
    keys.map(async (key) => {
      const kind = classify(key)
      if (!kind) return { key, verdict: 'ok' as const } // unrecognised shape: not proof of anything either way
      const head = await readObjectHead(key)
      // A transient read failure (network blip, R2 hiccup) is NOT the same as a
      // confirmed content mismatch — treating it as one would delete a
      // legitimately-uploaded file over a hiccup that has nothing to do with its
      // content. Only a byte pattern we actually read and rejected gets deleted;
      // an unreadable object just fails this request (the client's putFiles()
      // surfaces it as an upload error) and is left for the existing orphan
      // cleanup to reclaim later — a cost, not a security hole, since no DB row
      // ever gets inserted for it.
      if (!head) return { key, verdict: 'unreadable' as const }
      return { key, verdict: matches(kind, head) ? ('ok' as const) : ('mismatch' as const) }
    })
  )

  const mismatched = checks.filter((c) => c.verdict === 'mismatch').map((c) => c.key)
  if (mismatched.length) await deleteObjects(mismatched)

  if (mismatched.length) {
    return NextResponse.json({ error: 'File content did not match its declared type.' }, { status: 415 })
  }
  if (checks.some((c) => c.verdict === 'unreadable')) {
    return NextResponse.json({ error: 'Could not verify the upload. Try again.' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
