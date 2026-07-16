'use client'
// Admin editor for guides/articles (migration 0020). List every article (incl.
// drafts), create/edit one (title, slug, excerpt, cover URL, Markdown body,
// published toggle), delete, with a live Markdown preview. is_admin() RLS is the
// real access gate; this is just the UI.
import { useEffect, useRef, useState } from 'react'
import {
  fetchAllArticles,
  saveArticle,
  deleteArticle,
  type Article,
  type ArticleInput,
} from '@/lib/blog'
import { renderMarkdown } from '@/lib/markdown'

const BLANK: ArticleInput = { slug: '', title: '', excerpt: '', bodyMd: '', coverUrl: null, published: false }

export default function ArticlesEditor() {
  const [list, setList] = useState<Article[] | null>(null)
  const [editing, setEditing] = useState<ArticleInput | null>(null)
  const [existing, setExisting] = useState<Article | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const alive = useRef(true)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function reload() {
    const rows = await fetchAllArticles()
    if (alive.current) setList(rows)
  }

  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  function edit(a: Article) {
    setExisting(a)
    setEditing({
      slug: a.slug,
      title: a.title,
      excerpt: a.excerpt,
      bodyMd: a.bodyMd,
      coverUrl: a.coverUrl,
      published: a.published,
    })
    setErr('')
  }
  function newArticle() {
    setExisting(null)
    setEditing({ ...BLANK })
    setErr('')
  }
  function set(patch: Partial<ArticleInput>) {
    setEditing((e) => (e ? { ...e, ...patch } : e))
  }

  async function save() {
    if (!editing) return
    setBusy(true)
    setErr('')
    try {
      await saveArticle(editing, existing)
      await reload()
      if (!alive.current) return
      setSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => alive.current && setSaved(false), 1800)
    } catch (e) {
      if (alive.current) setErr(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  async function remove(a: Article) {
    if (!confirm(`Delete “${a.title || a.slug}”? This can't be undone.`)) return
    setBusy(true)
    try {
      await deleteArticle(a.id)
      if (existing?.id === a.id) {
        setEditing(null)
        setExisting(null)
      }
      await reload()
    } catch (e) {
      if (alive.current) setErr(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <section className="me-section">
      <h2>Guides</h2>
      <p className="me-note" style={{ marginTop: 0 }}>
        Articles shown at <code>/articles</code>. Draft privately, publish when ready. Body is Markdown.
      </p>

      {list === null ? (
        <p className="me-note">Loading…</p>
      ) : (
        <div className="admin-articles-list">
          {list.map((a) => (
            <div className="admin-article-row" key={a.id}>
              <span className={`admin-article-badge${a.published ? ' live' : ''}`}>
                {a.published ? 'Live' : 'Draft'}
              </span>
              <span className="admin-article-row-title">{a.title || a.slug || '(untitled)'}</span>
              <button className="btn-line" onClick={() => edit(a)}>Edit</button>
              <button className="btn-line danger" onClick={() => void remove(a)} disabled={busy}>Delete</button>
            </div>
          ))}
          {list.length === 0 && <p className="me-note">No articles yet.</p>}
        </div>
      )}

      {!editing ? (
        <button className="btn-line btn-gold" onClick={newArticle}>+ New article</button>
      ) : (
        <div className="admin-article-editor">
          <label className="me-field">
            <span>Title</span>
            <input value={editing.title} onChange={(e) => set({ title: e.target.value })} placeholder="How to open a web solo show" />
          </label>
          <label className="me-field">
            <span>URL slug — /articles/…</span>
            <input value={editing.slug} onChange={(e) => set({ slug: e.target.value })} placeholder="open-a-web-solo-show" />
          </label>
          <label className="me-field">
            <span>Excerpt (list + SEO description)</span>
            <textarea value={editing.excerpt} onChange={(e) => set({ excerpt: e.target.value })} rows={2} placeholder="One or two sentences shown on the list and in search results." />
          </label>
          <label className="me-field">
            <span>Cover image URL (optional)</span>
            <input value={editing.coverUrl ?? ''} onChange={(e) => set({ coverUrl: e.target.value.trim() || null })} placeholder="https://…" />
          </label>
          <label className="me-field">
            <span>Body (Markdown)</span>
            <textarea className="md-input" value={editing.bodyMd} onChange={(e) => set({ bodyMd: e.target.value })} placeholder={'## A heading\n\nA paragraph with **bold**, *italic* and a [link](https://example.com).\n\n- a list item\n- another'} />
          </label>

          <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.4rem 0 0.9rem' }}>
            <input type="checkbox" checked={editing.published} onChange={(e) => set({ published: e.target.checked })} />
            <span>Published (visible at /articles)</span>
          </label>

          <div className="hako-actions">
            <button className="btn-line btn-gold" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : saved ? 'Saved' : 'Save article'}
            </button>
            <button className="btn-line" onClick={() => { setEditing(null); setExisting(null); setErr('') }} disabled={busy}>
              Close
            </button>
          </div>
          {err && <p className="me-error">{err}</p>}

          {editing.bodyMd.trim() && (
            <div className="admin-article-preview">
              <p className="admin-article-preview-label">Preview</p>
              <div className="article-body">{renderMarkdown(editing.bodyMd)}</div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
