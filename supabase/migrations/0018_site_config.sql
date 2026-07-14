-- Site-wide config the admin console edits and the public site reads. First use:
-- which artworks the landing-page hero shows (one setting drives PC and mobile,
-- since both read the same row). Extensible key/value so later site settings don't
-- each need a migration.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create table if not exists public.site_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_config enable row level security;

-- The landing page is public, so anyone (anon key) may read config.
drop policy if exists "site_config_read_all" on public.site_config;
create policy "site_config_read_all" on public.site_config
  for select using (true);

-- Only admins may change it (is_admin() from 0017).
drop policy if exists "site_config_write_admin" on public.site_config;
create policy "site_config_write_admin" on public.site_config
  for all using (public.is_admin()) with check (public.is_admin());
