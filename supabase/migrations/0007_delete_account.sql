-- アカウント削除(要件10.1)
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)
--
-- クライアントの anon キーでは auth.users を消せないため、本人限定の
-- security definer 関数を用意する。auth.users の削除は FK の cascade で
-- profiles → artworks / galleries → placements まで連鎖する。
-- (Storage のファイルは cascade されないので、クライアント側で先に削除する)

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
