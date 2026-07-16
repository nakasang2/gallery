-- 来場者エンゲージメント: 訪問記録・芳名帳・いいね(要件フェーズ2)
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ---- 訪問(公開ページのビュー記録。解析用) ---- */
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists visits_gallery_idx on public.visits (gallery_id, created_at desc);

alter table public.visits enable row level security;

-- 誰でも「公開中のギャラリーに対してのみ」記録できる。読めるのはオーナーだけ
drop policy if exists "visits_insert_public" on public.visits;
create policy "visits_insert_public"
  on public.visits for insert
  with check (exists (select 1 from public.galleries g where g.id = gallery_id and g.is_public));

drop policy if exists "visits_select_own" on public.visits;
create policy "visits_select_own"
  on public.visits for select
  using (exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid())));

/* ---- 芳名帳(来場コメント。公開ギャラリーでは誰でも読める) ---- */
create table if not exists public.guestbook (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 40),
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists guestbook_gallery_idx on public.guestbook (gallery_id, created_at desc);

alter table public.guestbook enable row level security;

drop policy if exists "guestbook_insert_public" on public.guestbook;
create policy "guestbook_insert_public"
  on public.guestbook for insert
  with check (exists (select 1 from public.galleries g where g.id = gallery_id and g.is_public));

drop policy if exists "guestbook_select_public_or_own" on public.guestbook;
create policy "guestbook_select_public_or_own"
  on public.guestbook for select
  using (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id and (g.is_public or g.owner_id = (select auth.uid()))
    )
  );

-- 迷惑コメントはオーナーが消せる
drop policy if exists "guestbook_delete_own" on public.guestbook;
create policy "guestbook_delete_own"
  on public.guestbook for delete
  using (exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid())));

/* ---- いいね(作品ごと・匿名。重複防止はクライアント側のベストエフォート) ---- */
create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists likes_gallery_idx on public.likes (gallery_id);
create index if not exists likes_artwork_idx on public.likes (artwork_id);

alter table public.likes enable row level security;

drop policy if exists "likes_insert_public" on public.likes;
create policy "likes_insert_public"
  on public.likes for insert
  with check (exists (select 1 from public.galleries g where g.id = gallery_id and g.is_public));

drop policy if exists "likes_select_public_or_own" on public.likes;
create policy "likes_select_public_or_own"
  on public.likes for select
  using (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id and (g.is_public or g.owner_id = (select auth.uid()))
    )
  );
