'use client'
// Dashboard: manage your hakoniwa (create / rename / publish / delete), profile, and links.
// Designed for multiple galleries; the release plan caps creation at PLAN.galleries.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useGallery } from '@/lib/store'
import { TEMPLATES } from '@/lib/presets'
import { PLAN } from '@/lib/limits'
import {
  listMyGalleries,
  createGallery,
  renameGallery,
  deleteGallery,
  setGalleryPublic,
  rowToSettings,
  type GalleryRow,
} from '@/lib/galleries'
import { getProfile, saveProfile, setUsername, USERNAME_RE } from '@/lib/publish'

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

// Create a hakoniwa: name + template as the starting point (REQUIREMENTS 10.2)
function CreateCard({ onCreated }: { onCreated: () => void }) {
  const user = useGallery((s) => s.user)!
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const [title, setTitle] = useState('My Gallery')
  const [templateId, setTemplateId] = useState('salon')
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      await createGallery(user.id, { title, templateId })
      await refreshMyGallery()
      onCreated()
    } catch (e) {
      alert(`Could not create the hakoniwa: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="me-card">
      <p className="me-note" style={{ marginTop: 0 }}>
        You don&apos;t have a hakoniwa yet. Pick a starting template — everything can be changed later
        in the editor.
      </p>
      <label className="me-field">
        <span>Name</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="chips" style={{ margin: '0.4rem 0 1.2rem' }}>
        {Object.entries(TEMPLATES).map(([key, t]) => (
          <button
            key={key}
            className={`chip${key === templateId ? ' active' : ''}`}
            onClick={() => setTemplateId(key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button className="btn-line" disabled={busy} onClick={() => void create()}>
        {busy ? 'Creating…' : 'Create hakoniwa'}
      </button>
    </div>
  )
}

function HakoniwaCard({ row, onChanged }: { row: GalleryRow; onChanged: () => void }) {
  const username = useGallery((s) => s.profileUsername)
  const cloudArtworks = useGallery((s) => s.cloudArtworks)
  const frameOverrides = useGallery((s) => s.frameOverrides)
  const refreshMyGallery = useGallery((s) => s.refreshMyGallery)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameInput, setNameInput] = useState(row.title)
  const [copied, setCopied] = useState(false)

  const publicUrl =
    typeof window !== 'undefined' && username ? `${location.origin}/@${username}/${row.slug}` : ''

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      await refreshMyGallery()
      onChanged()
    } catch (e) {
      alert(`${label} failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  async function togglePublic() {
    if (!row.is_public && !username) {
      alert('Set a username first (Profile section below) — it becomes part of your public URL.')
      return
    }
    if (!row.is_public && cloudArtworks.length === 0) {
      alert('Exhibit at least one work before opening to the public (use the editor).')
      return
    }
    await run(row.is_public ? 'Making private' : 'Publishing', () =>
      setGalleryPublic(row, !row.is_public, rowToSettings(row, frameOverrides), cloudArtworks)
    )
  }

  return (
    <div className="me-card">
      <div className="hako-head">
        <span className="hako-title">{row.title}</span>
        <span className={`hako-badge${row.is_public ? ' public' : ''}`}>
          {row.is_public ? 'PUBLIC' : 'PRIVATE'}
        </span>
      </div>
      <p className="hako-meta">
        {cloudArtworks.length} work{cloudArtworks.length === 1 ? '' : 's'} exhibited
        {row.updated_at ? ` · updated ${fmtDate(row.updated_at)}` : ''}
        {row.is_public && publicUrl ? (
          <>
            {' · '}
            <a href={publicUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
              {publicUrl.replace(/^https?:\/\//, '')}
            </a>
          </>
        ) : null}
      </p>

      {renaming ? (
        <div className="field-row">
          <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
          <button
            className="btn-line"
            disabled={busy}
            onClick={() =>
              void run('Rename', async () => {
                await renameGallery(row.id, nameInput)
                setRenaming(false)
              })
            }
          >
            Save
          </button>
          <button className="btn-line" onClick={() => setRenaming(false)}>Cancel</button>
        </div>
      ) : (
        <div className="hako-actions">
          <Link className="btn-line" href="/demo">Open editor</Link>
          <button className="btn-line" disabled={busy} onClick={() => void togglePublic()}>
            {row.is_public ? 'Make private' : 'Open to the public'}
          </button>
          {row.is_public && publicUrl && (
            <button
              className="btn-line"
              onClick={() => {
                void navigator.clipboard.writeText(publicUrl).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                })
              }}
            >
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          )}
          <button className="btn-line" onClick={() => { setNameInput(row.title); setRenaming(true) }}>
            Rename
          </button>
          <button
            className="btn-line hako-danger"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Delete “${row.title}”? Your works stay in the library, but the room and its public page are removed.`)) return
              void run('Delete', () => deleteGallery(row.id))
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function ProfileCard() {
  const user = useGallery((s) => s.user)!
  const username = useGallery((s) => s.profileUsername)
  const refreshCloud = useGallery((s) => s.refreshCloudArtworks)
  const [nameInput, setNameInput] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    getProfile(user.id)
      .then((p) => {
        if (!alive) return
        setDisplayName(p.displayName)
        setBio(p.bio)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user.id])

  async function saveUsername() {
    const name = nameInput.trim().toLowerCase()
    if (!USERNAME_RE.test(name)) {
      alert('Usernames are 3–20 characters: lowercase letters, digits and _')
      return
    }
    setBusy(true)
    try {
      await setUsername(user.id, name)
      await refreshCloud()
      setNameInput('')
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      await saveProfile(user.id, { displayName, bio })
      await refreshCloud()
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    } catch (e) {
      alert(`Could not save your profile: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="me-card">
      <label className="me-field">
        <span>Username — public URL: /@{username ?? 'username'}/…</span>
        <div className="field-row" style={{ marginTop: 0 }}>
          <input
            type="text"
            placeholder={username ?? 'username'}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <button className="btn-line" disabled={busy || !nameInput.trim()} onClick={() => void saveUsername()}>
            {username ? 'Change' : 'Set'}
          </button>
        </div>
      </label>
      <label className="me-field">
        <span>Display name (artist name)</span>
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="me-field">
        <span>Bio / statement</span>
        <textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>
      <button className="btn-line" disabled={busy} onClick={() => void save()}>
        {saved ? 'Saved' : 'Save profile'}
      </button>
    </div>
  )
}

export default function MePage() {
  const user = useGallery((s) => s.user)
  const initAuth = useGallery((s) => s.initAuth)
  const hydrate = useGallery((s) => s.hydrate)
  const signOut = useGallery((s) => s.signOut)

  const [checked, setChecked] = useState(false)
  const [galleries, setGalleries] = useState<GalleryRow[]>([])
  const [loadErr, setLoadErr] = useState('')

  useEffect(() => {
    hydrate() // frameOverrides etc. from this browser feed placement rebuilds
    initAuth()
    supabase?.auth.getSession().then(() => setChecked(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reload = useCallback(async () => {
    if (!user) return
    try {
      setGalleries(await listMyGalleries(user.id))
      setLoadErr('')
    } catch (e) {
      console.error(e)
      setLoadErr('Could not load your hakoniwa. Check that supabase/migrations up to 0005 have been applied.')
    }
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!supabase) {
    return (
      <main className="me-page">
        <div className="me-inner">
          <p className="me-note">Cloud features are not configured (Supabase keys required in .env.local).</p>
        </div>
      </main>
    )
  }

  return (
    <main className="me-page">
      <div className="me-inner">
        <div className="me-top">
          <Link href="/" className="auth-logo">HAKONIWA</Link>
          <div className="me-top-actions">
            <Link className="btn-line" href="/demo">Editor</Link>
            {user && (
              <button className="btn-line" onClick={() => void signOut()}>Sign out</button>
            )}
          </div>
        </div>

        {!user && checked && (
          <div className="me-card">
            <p className="me-note" style={{ marginTop: 0 }}>You are not signed in.</p>
            <div className="hako-actions">
              <Link className="btn-line" href="/signin">Sign in</Link>
              <Link className="btn-line" href="/signup">Create account</Link>
            </div>
          </div>
        )}

        {user && (
          <>
            <h1 className="me-h1">My hakoniwa</h1>
            <section className="me-section">
              {loadErr && <p className="me-error">{loadErr}</p>}
              {!loadErr && galleries.length === 0 && <CreateCard onCreated={() => void reload()} />}
              {galleries.map((g) => (
                <HakoniwaCard key={g.id} row={g} onChanged={() => void reload()} />
              ))}
              {galleries.length > 0 && galleries.length < PLAN.galleries && (
                <p className="me-note">
                  You can create {PLAN.galleries - galleries.length} more hakoniwa on your plan.
                </p>
              )}
            </section>

            <section className="me-section">
              <h2>Profile</h2>
              <ProfileCard />
            </section>
          </>
        )}
      </div>
    </main>
  )
}
