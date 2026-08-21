-- 反復侵害者の記録を残す（リリース前監査 #47・2026-08-21）
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）
--
-- なぜ必要か: terms/page.tsx §4・§7（PR #69・法務#33）で「複数の有効な著作権侵害通知を
-- 受けたアカウントは終了する」という常習侵害者ポリシーを規約に明記した。DMCAの
-- セーフハーバー適格要件(§512(i))は「そのポリシーを実際に運用できること」を求めるが、
-- **誰が何回取り下げられたかを記録する場所が無いと、方針は書いてあるだけで運用できない**。
--
-- 対象を著作権の通報に絞るのは、admin_takedown_artwork(0073)自体は理由を問わない
-- 汎用の削除経路だから ── 嫌がらせ・違法内容の通報での削除まで「著作権侵害」として
-- 数えると、ポリシーの適用対象を実際より広げてしまう。
--
-- artworks への外部キーは張らない: この行の目的は作品が消えたあとも残る記録
-- （0069のpurchasesと同じ理由）で、削除される側の行を指すFKは削除と競合する。

create table if not exists public.copyright_strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  artwork_id uuid not null,
  artwork_title text not null default '',
  created_at timestamptz not null default now()
);

alter table public.copyright_strikes enable row level security;

-- 閲覧は運営者のみ（通報者の氏名等と同じ扱い方針。0056のコメント参照）。
drop policy if exists "copyright_strikes_select_admin" on public.copyright_strikes;
create policy "copyright_strikes_select_admin" on public.copyright_strikes
  for select using (public.is_admin());

-- insertポリシーは無い（誰にも書かせない）。security definer の下のRPCだけが書く
-- ── admin_takedown_artwork(0073)と同じ形: 呼び出し元は管理者自身のセッションで
-- 呼べるが、内部でis_admin()を確認したうえで書き込む。
create or replace function public.admin_record_copyright_strike(p_user uuid, p_artwork uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_record_copyright_strike: not authorised';
  end if;

  insert into public.copyright_strikes (user_id, artwork_id, artwork_title)
  values (p_user, p_artwork, coalesce(p_title, ''));
end;
$$;

revoke all on function public.admin_record_copyright_strike(uuid, uuid, text) from public;
grant execute on function public.admin_record_copyright_strike(uuid, uuid, text) to authenticated;
