'use client'
// Visitor guestbook: read what others wrote, leave your own note (public galleries only)
import { useEffect, useState } from 'react'
import { useGallery } from '@/lib/store'
import { showToast } from '@/lib/toast'
import { listGuestbook, addGuestbookEntry, type GuestbookEntry } from '@/lib/engagement'

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export default function GuestbookPanel() {
  const visitor = useGallery((s) => s.visitor)
  const open = useGallery((s) => s.guestbookOpen)
  const setOpen = useGallery((s) => s.setGuestbookOpen)

  const [entries, setEntries] = useState<GuestbookEntry[]>([])
  const [unavailable, setUnavailable] = useState(false)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [thanks, setThanks] = useState(false)

  const galleryId = visitor?.galleryId

  useEffect(() => {
    if (!open || !galleryId) return
    listGuestbook(galleryId)
      .then((e) => {
        setEntries(e)
        setUnavailable(false)
      })
      .catch(() => setUnavailable(true)) // migration 0008 not applied
  }, [open, galleryId])

  if (!visitor) return null

  async function submit() {
    if (!message.trim() || busy || !galleryId) return
    setBusy(true)
    try {
      await addGuestbookEntry(galleryId, name, message)
      setMessage('')
      setThanks(true)
      setTimeout(() => setThanks(false), 2400)
      setEntries(await listGuestbook(galleryId))
    } catch (e) {
      showToast(`Could not sign the guestbook: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside id="guestbook" className={`panel guestbook${open ? ' open' : ''}`} aria-hidden={!open} inert={!open}>
      <button className="panel-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
      <h2 className="panel-title">Guestbook</h2>
      <p className="gb-sub">Leave a note for {visitor.ownerName}.</p>

      {unavailable ? (
        <p className="gb-sub">The guestbook is not available for this gallery.</p>
      ) : (
        <>
          <div className="field-row">
            <input
              type="text"
              placeholder="Name (optional)"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field-row">
            <textarea
              className="gb-input"
              placeholder="Your impressions…"
              rows={3}
              maxLength={500}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <button className="btn-line" disabled={busy || !message.trim()} onClick={() => void submit()}>
            {thanks ? 'Thank you!' : 'Sign the guestbook'}
          </button>

          <ul className="gb-list" style={{ marginTop: '1.8rem' }}>
            {entries.map((e) => (
              <li key={e.id}>
                <div className="gb-meta">
                  <b>{e.name || 'Anonymous'}</b> · {fmtDate(e.created_at)}
                </div>
                <p>{e.message}</p>
              </li>
            ))}
          </ul>
          {entries.length === 0 && <p className="gb-sub" style={{ marginTop: '1.4rem' }}>Be the first to sign.</p>}
        </>
      )}
    </aside>
  )
}
