-- 通報のDB化(mailto導線の置き換え)
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  -- 通報対象(自由記述のURL/ハンドル。ギャラリー削除後も通報記録は残す)
  about text not null check (char_length(about) <= 200),
  reason text not null check (char_length(reason) between 1 and 1000),
  contact text not null default '' check (char_length(contact) <= 200),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- 誰でも送信できる。閲覧ポリシーは作らない(運用者が service role / SQL Editor で見る)
drop policy if exists "reports_insert_any" on public.reports;
create policy "reports_insert_any"
  on public.reports for insert
  with check (true);
