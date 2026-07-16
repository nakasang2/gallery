-- 0024: expose a public gallery's cumulative visit COUNT to anon (REQUIREMENTS.md §11.19).
-- The visits table's SELECT policy is owner-only (0008), so a visitor can't read it to
-- drive the ambient "past-visitor presence" (§11.19). This SECURITY DEFINER function
-- returns ONLY the aggregate count, and only for a *public* gallery — no individual rows,
-- no timestamps, nothing identifying. Anyone may call it (it's social proof), but it can't
-- be used to peek at private rooms.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create or replace function public.public_visit_count(p_gallery uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(count(*), 0)::int
  from public.visits v
  where v.gallery_id = p_gallery
    and exists (select 1 from public.galleries g where g.id = p_gallery and g.is_public);
$$;

revoke all on function public.public_visit_count(uuid) from public;
grant execute on function public.public_visit_count(uuid) to anon, authenticated;
