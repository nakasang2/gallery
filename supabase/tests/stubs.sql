create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
alter role service_role bypassrls;
create schema if not exists auth;
create schema if not exists storage;
grant usage on schema public, auth, storage to authenticated, anon, service_role;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id), name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to authenticated, anon, service_role;

-- Supabase は schema public の**今後作られる**テーブル/関数にも権限を配る
-- （`alter default privileges`）。これが無いと、migration があとで作った表に
-- 権限が付かず「permission denied for table」になる＝本番と違う結果になる。
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Supabase の storage ヘルパ。0001 のストレージポリシーが使う。
-- **これが無いと 0001 の途中で止まる** — ON_ERROR_STOP 無しで流していると
-- 「後半が全部未適用」なのに成功したように見える（実際にそう見えていた）。
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select case when array_length(string_to_array(name, '/'), 1) > 1
    then (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
    else array[]::text[] end
$$;
create or replace function storage.filename(name text) returns text
language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create or replace function storage.extension(name text) returns text
language sql immutable as $$ select nullif(split_part(storage.filename(name), '.', 2), '') $$;
