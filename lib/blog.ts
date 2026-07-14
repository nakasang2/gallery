// Articles / guides data layer (migration 0020). Public pages read published
// rows through the anon key + RLS; the admin console does full CRUD (is_admin()
// RLS is the real gate — these functions are just the calls). Bodies are stored
// as Markdown and rendered app-side (lib/markdown), so no HTML is ever persisted.
import { supabase } from './supabase'

export interface Article {
  id: string
  slug: string
  title: string
  excerpt: string
  bodyMd: string
  coverUrl: string | null
  published: boolean
  publishedAt: string | null
  updatedAt: string | null
}

/** Card shape for the /articles list — no body, so the list stays light */
export interface ArticleCard {
  slug: string
  title: string
  excerpt: string
  coverUrl: string | null
  publishedAt: string | null
}

type Row = {
  id: string
  slug: string
  title: string
  excerpt: string
  body_md: string
  cover_url: string | null
  published: boolean
  published_at: string | null
  updated_at: string | null
}

function rowToArticle(r: Row): Article {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    bodyMd: r.body_md,
    coverUrl: r.cover_url,
    published: r.published,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
  }
}

export const SLUG_RE = /^[a-z0-9-]{1,80}$/

/** Published articles, newest first — the public /articles list. */
export async function fetchPublishedArticles(): Promise<ArticleCard[]> {
  if (!supabase) return []
  try {
    const { data, error } = await supabase
      .from('articles')
      .select('slug, title, excerpt, cover_url, published_at')
      .eq('published', true)
      .order('published_at', { ascending: false, nullsFirst: false })
    if (error || !data) return []
    return (data as Pick<Row, 'slug' | 'title' | 'excerpt' | 'cover_url' | 'published_at'>[]).map((r) => ({
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      coverUrl: r.cover_url,
      publishedAt: r.published_at,
    }))
  } catch {
    return []
  }
}

/** One published article by slug, or null (unpublished/missing → 404 upstream). */
export async function fetchArticle(slug: string): Promise<Article | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('articles')
      .select('id, slug, title, excerpt, body_md, cover_url, published, published_at, updated_at')
      .eq('slug', slug)
      .eq('published', true)
      .maybeSingle()
    if (error || !data) return null
    return rowToArticle(data as Row)
  } catch {
    return null
  }
}

// ---- Admin CRUD (is_admin() RLS enforces access; anon calls just return nothing) ----

/** Every article incl. drafts — admin list. */
export async function fetchAllArticles(): Promise<Article[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, excerpt, body_md, cover_url, published, published_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error || !data) return []
  return (data as Row[]).map(rowToArticle)
}

export interface ArticleInput {
  slug: string
  title: string
  excerpt: string
  bodyMd: string
  coverUrl: string | null
  published: boolean
}

/** Create or update by slug. Sets published_at the first time it goes public. */
export async function saveArticle(input: ArticleInput, existing?: Article | null): Promise<void> {
  const slug = input.slug.trim().toLowerCase()
  if (!SLUG_RE.test(slug)) {
    throw new Error('URLs are 1–80 chars: lowercase letters, digits and hyphens.')
  }
  const now = new Date().toISOString()
  // Stamp published_at when it first becomes public; keep the original date after that
  const publishedAt = input.published ? existing?.publishedAt ?? now : existing?.publishedAt ?? null
  const row = {
    slug,
    title: input.title.trim(),
    excerpt: input.excerpt.trim(),
    body_md: input.bodyMd,
    cover_url: input.coverUrl,
    published: input.published,
    published_at: publishedAt,
    updated_at: now,
  }
  const { error } = await supabase!.from('articles').upsert(row, { onConflict: 'slug' })
  if (error) {
    if (error.code === '23505') throw new Error('That URL is already used by another article.')
    throw error
  }
}

export async function deleteArticle(id: string): Promise<void> {
  const { error } = await supabase!.from('articles').delete().eq('id', id)
  if (error) throw error
}
