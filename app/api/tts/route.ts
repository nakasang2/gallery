// POST /api/tts — audio-guide text-to-speech via OpenAI, cached in Storage.
// The browser calls this when playing a work's caption aloud; it returns a stable
// public mp3 URL. To keep cost bounded and prevent arbitrary-text abuse, the caller
// sends only a workId — the caption is read from the DB here, so this can only ever
// synthesize real captions. The same caption (+model+voice) is generated once and
// cached in Storage, so repeat plays and repeat visitors cost nothing. When this
// route is unconfigured (501) or fails, the client falls back to browser speech.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { ARTWORKS } from '@/lib/artworks'

export const runtime = 'nodejs'

// gpt-4o-mini-tts: cheapest current TTS, multilingual (handles Japanese captions).
const MODEL = 'gpt-4o-mini-tts'
const DEFAULT_VOICE = 'alloy'
// OpenAI's built-in voice set (guard the value we forward).
const ALLOWED_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'])
// Captions are short (≤140 in the editor); cap generously but bound cost per call.
const MAX_CHARS = 1000

export async function POST(req: NextRequest) {
  const openaiKey = process.env.OPENAI_API_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!openaiKey || !supabaseUrl || !serviceKey) {
    // Not configured — the client falls back to browser speech synthesis.
    return NextResponse.json({ error: 'TTS is not configured.' }, { status: 501 })
  }

  let body: { workId?: unknown; voice?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const workId = typeof body.workId === 'string' ? body.workId : ''
  const voice = typeof body.voice === 'string' && ALLOWED_VOICES.has(body.voice) ? body.voice : DEFAULT_VOICE
  if (!workId) return NextResponse.json({ error: 'Missing workId.' }, { status: 400 })

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // The ONLY text we synthesize is a real caption we look up server-side (never
  // client-supplied), so this can't be abused to voice arbitrary text.
  // Bundled demo works (/demo — ids like "a01") are checked first: they aren't in
  // the DB, and their ids aren't uuids, so querying the DB for them would error.
  let text = (ARTWORKS.find((a) => a.id === workId)?.desc ?? '').trim()
  if (!text) {
    const { data: art, error: readErr } = await db
      .from('artworks')
      .select('description')
      .eq('id', workId)
      .maybeSingle()
    if (readErr) {
      console.error('tts: artwork read failed', readErr.message)
      return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 })
    }
    text = (art?.description ?? '').trim()
  }
  if (!text) return NextResponse.json({ error: 'No caption to read.' }, { status: 404 })
  if (text.length > MAX_CHARS) return NextResponse.json({ error: 'Caption too long.' }, { status: 400 })

  // Cache key covers model + voice + text, so a caption edit or voice change misses.
  const hash = createHash('sha256').update(`${MODEL}\n${voice}\n${text}`).digest('hex').slice(0, 32)
  const path = `tts/${hash}.mp3`
  const publicUrl = db.storage.from('artworks').getPublicUrl(path).data.publicUrl

  // Cache hit: the object already exists, no OpenAI call.
  const head = await fetch(publicUrl, { method: 'HEAD' }).catch(() => null)
  if (head && head.ok) return NextResponse.json({ url: publicUrl, cached: true })

  // Generate with OpenAI.
  let audio: ArrayBuffer
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, voice, input: text, response_format: 'mp3' }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('tts: openai failed', res.status, detail.slice(0, 300))
      return NextResponse.json({ error: 'Generation failed.' }, { status: 502 })
    }
    audio = await res.arrayBuffer()
  } catch (e) {
    console.error('tts: openai error', e)
    return NextResponse.json({ error: 'Generation failed.' }, { status: 502 })
  }

  const up = await db.storage.from('artworks').upload(path, Buffer.from(audio), {
    contentType: 'audio/mpeg',
    upsert: true,
    cacheControl: '31536000',
  })
  if (up.error) {
    console.error('tts: cache upload failed', up.error.message)
    return NextResponse.json({ error: 'Storage failed.' }, { status: 500 })
  }
  return NextResponse.json({ url: publicUrl, cached: false })
}
