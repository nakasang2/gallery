-- Moderation: make reports actionable, and let an artist close their guestbook.
--
-- Reports were already readable by admins (0017 `reports_select_admin`) but there
-- was nowhere to record what was done about one, and no way to take a gallery
-- down short of the SQL Editor. The /admin page showed a count and nothing else.
--
-- Guestbooks were anonymous, unmoderated, and could not be switched off — the
-- owner could only delete entries after they appeared.
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 通報に対応状態を持たせる ================= */
alter table public.reports
  add column if not exists status text not null default 'open';
alter table public.reports
  drop constraint if exists reports_status_check;
alter table public.reports
  add constraint reports_status_check check (status in ('open', 'actioned', 'dismissed'));
alter table public.reports
  add column if not exists handled_at timestamptz;
-- What the operator decided, for the audit trail a takedown dispute would need.
alter table public.reports
  add column if not exists handled_note text not null default '';

create index if not exists reports_open_idx on public.reports (created_at desc) where status = 'open';

-- Admins may work the queue. Still no delete policy: a handled report is the
-- record that the decision was made, so it stays.
drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin" on public.reports
  for update using (public.is_admin()) with check (public.is_admin());

/* ================= 2. 管理者による非公開化 ================= */
-- A function rather than a blanket admin UPDATE policy on galleries: taking a
-- gallery down is the ONE cross-user write an admin needs, and this is the only
-- thing it can do. Everything else about someone else's room stays untouchable.
create or replace function public.admin_set_gallery_public(p_gallery uuid, p_public boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if not public.is_admin() then
    raise exception 'admin_set_gallery_public: not authorised';
  end if;
  update public.galleries set is_public = p_public where id = p_gallery;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.admin_set_gallery_public(uuid, boolean) from public;
revoke all on function public.admin_set_gallery_public(uuid, boolean) from anon;
grant execute on function public.admin_set_gallery_public(uuid, boolean) to authenticated;

/* ================= 3. 芳名帳のON/OFF ================= */
-- Defaults to true so nothing changes for existing rooms.
alter table public.galleries
  add column if not exists guestbook_enabled boolean not null default true;

-- Enforced in the policy, not just the UI: hiding the form would still leave the
-- table writable by anyone who can craft a request.
drop policy if exists "guestbook_insert_public" on public.guestbook;
create policy "guestbook_insert_public"
  on public.guestbook for insert
  with check (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id and g.is_public and g.guestbook_enabled
    )
  );
