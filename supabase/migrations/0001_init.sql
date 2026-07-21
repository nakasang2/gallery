-- Xibit360 初期スキーマ(docs/ARCHITECTURE.md 3章)
-- 適用方法: Supabaseダッシュボード → SQL Editor にこのファイル全文を貼り付けて Run
-- (プロジェクト: https://supabase.com/dashboard/project/ncffdcvsksiutsjerpeb/sql/new)
-- 再実行しても安全(if not exists / drop ... if exists でガード済み)

/* ================= 1. テーブル ================= */
-- ポリシーが相互にテーブルを参照するため、先にテーブルを全て作る

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  bio text default '',
  avatar_url text,
  sns jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null, -- 'artworks' バケット内の {owner_id}/{artwork_id}
  width int not null check (width > 0),
  height int not null check (height > 0),
  title text not null default '無題',
  description text not null default '',
  year int,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists artworks_owner_idx on public.artworks (owner_id, created_at desc);

create table if not exists public.galleries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null default 'main' check (slug ~ '^[a-z0-9-]{1,40}$'),
  title text not null default '私のギャラリー',
  statement text not null default '',
  theme text not null default 'chic',
  layout text not null default 'hall',
  frame_default text not null default 'black',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table if not exists public.placements (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  slot_index int not null check (slot_index >= 0),
  frame_override text,
  unique (gallery_id, slot_index)
);

/* ================= 2. サインアップ時のプロフィール自動作成 ================= */

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ================= 3. RLS ポリシー ================= */
-- 方針: 自分の行だけ書ける / 公開ギャラリー(is_public)に属するものは誰でも読める

alter table public.profiles enable row level security;
alter table public.artworks enable row level security;
alter table public.galleries enable row level security;
alter table public.placements enable row level security;

-- profiles
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update using ((select auth.uid()) = id);

-- artworks
drop policy if exists "artworks_owner_all" on public.artworks;
create policy "artworks_owner_all"
  on public.artworks for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "artworks_select_in_public_gallery" on public.artworks;
create policy "artworks_select_in_public_gallery"
  on public.artworks for select
  using (
    exists (
      select 1
      from public.placements p
      join public.galleries g on g.id = p.gallery_id
      where p.artwork_id = artworks.id and g.is_public
    )
  );

-- galleries
drop policy if exists "galleries_owner_all" on public.galleries;
create policy "galleries_owner_all"
  on public.galleries for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "galleries_select_public" on public.galleries;
create policy "galleries_select_public"
  on public.galleries for select using (is_public);

-- placements
drop policy if exists "placements_owner_all" on public.placements;
create policy "placements_owner_all"
  on public.placements for all
  using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  );

drop policy if exists "placements_select_public" on public.placements;
create policy "placements_select_public"
  on public.placements for select
  using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.is_public)
  );

/* ================= 4. Storage: 作品画像バケット ================= */
-- 公開バケット(公開ギャラリー前提。読み取りは誰でも、書き込みは自分のフォルダのみ)

insert into storage.buckets (id, name, public)
values ('artworks', 'artworks', true)
on conflict (id) do nothing;

drop policy if exists "artwork_images_public_read" on storage.objects;
create policy "artwork_images_public_read"
  on storage.objects for select
  using (bucket_id = 'artworks');

drop policy if exists "artwork_images_insert_own" on storage.objects;
create policy "artwork_images_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'artworks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "artwork_images_update_own" on storage.objects;
create policy "artwork_images_update_own"
  on storage.objects for update
  using (
    bucket_id = 'artworks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "artwork_images_delete_own" on storage.objects;
create policy "artwork_images_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'artworks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
