-- ダッシュボード用: ギャラリーの更新日時
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

alter table public.galleries
  add column if not exists updated_at timestamptz not null default now();

-- 行の更新時に updated_at を自動更新
create or replace function public.touch_gallery()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists galleries_touch on public.galleries;
create trigger galleries_touch
  before update on public.galleries
  for each row execute function public.touch_gallery();
