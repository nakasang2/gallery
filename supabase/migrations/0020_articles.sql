-- Articles / guides (STRATEGY §4.1-3): SEO content the team publishes to pull
-- search traffic ("how to open a web solo show", etc.). Admin-authored (same
-- is_admin() gate as site_config/0017-0018); the public reads only published
-- rows. Markdown body is rendered app-side (lib/markdown) — no HTML is stored.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null default '',
  excerpt text not null default '',
  body_md text not null default '',
  cover_url text,
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fast listing of the public feed (published, newest first)
create index if not exists articles_published_idx
  on public.articles (published, published_at desc);

alter table public.articles enable row level security;

-- Anyone (anon key) may read PUBLISHED articles — this is public content.
drop policy if exists "articles_read_published" on public.articles;
create policy "articles_read_published" on public.articles
  for select using (published = true);

-- Admins may read everything (incl. drafts) and write. is_admin() from 0017.
drop policy if exists "articles_read_admin" on public.articles;
create policy "articles_read_admin" on public.articles
  for select using (public.is_admin());

drop policy if exists "articles_write_admin" on public.articles;
create policy "articles_write_admin" on public.articles
  for all using (public.is_admin()) with check (public.is_admin());
