-- 他人の作品を無断で自分の部屋に掛けられる穴を塞ぐ（ユーザー指示 2026-08-09）。
--
-- 何が空いていたか: `placements_owner_all`(0001) は **ギャラリーの所有者しか見ておらず、
-- 作品の所有者を見ていない**。そして `artworks_select_in_public_gallery`(0001) により
-- 公開ギャラリーに掛かった作品は誰でも読めるので、**作品の id は公開ページのペイロード
-- に載っている**。この2つを合わせると、認証済みユーザーは他人の公開作品の id を拾って
-- 自分の部屋の placement に入れられ、自分の展覧会として公開できた。作品の無断掲載は
-- 作家にとって最も重い事故の種類なので、合同展示（他人の作品を掛けることを正式な機能に
-- する変更）を待たずに塞ぐ。
--
-- 塞ぎ方: placement を作れるのは
--   ① その作品を自分が所有している か
--   ② その部屋への「受諾済みの招待」がその作品の所有者に出ている
-- のどちらか。②が合同展示の土台にもなる（主催者が招待し、作家が受諾して初めて掛かる）。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

/* ================= 1. 招待 ================= */
create table if not exists public.room_invites (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries (id) on delete cascade,
  -- 招かれた作家。この人の作品が、この部屋に掛けられるようになる。
  artist_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (gallery_id, artist_id)
);

create index if not exists room_invites_artist_idx on public.room_invites (artist_id, status);

alter table public.room_invites enable row level security;

-- 部屋の所有者: 自分の部屋の招待を出す・見る・取り下げる。
-- **status は自分では動かせない**（受諾は作家の意思表示なので、招いた側が
-- 勝手に 'accepted' にできてはいけない）。update は下の作家向けポリシーだけが持つ。
drop policy if exists "room_invites_owner_manage" on public.room_invites;
create policy "room_invites_owner_manage"
  on public.room_invites for select using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  );

drop policy if exists "room_invites_owner_insert" on public.room_invites;
create policy "room_invites_owner_insert"
  on public.room_invites for insert with check (
    status = 'pending'
    and exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  );

drop policy if exists "room_invites_owner_delete" on public.room_invites;
create policy "room_invites_owner_delete"
  on public.room_invites for delete using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  );

-- 招かれた作家: 自分宛の招待を見る／受諾・辞退する（＝いつでも取り下げられる）。
drop policy if exists "room_invites_artist_read" on public.room_invites;
create policy "room_invites_artist_read"
  on public.room_invites for select using (artist_id = (select auth.uid()));

drop policy if exists "room_invites_artist_respond" on public.room_invites;
create policy "room_invites_artist_respond"
  on public.room_invites for update
  using (artist_id = (select auth.uid()))
  with check (artist_id = (select auth.uid()) and status in ('accepted', 'declined'));

/* ================= 2. placement に同意を要求する ================= */
-- 「その作品を掛けてよいか」を1箇所で答える述語。placement のポリシーと、下の
-- 取り下げトリガの両方がこれを読むので、条件が2箇所に分かれてドリフトしない。
create or replace function public.may_place_artwork(p_gallery uuid, p_artwork uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- ① 部屋の所有者が、その作品の所有者でもある（今までの全ケースがこれ）
    select 1
      from public.galleries g
      join public.artworks a on a.id = p_artwork
     where g.id = p_gallery and a.owner_id = g.owner_id
  ) or exists (
    -- ② 作品の所有者が、この部屋への招待を受諾している
    select 1
      from public.artworks a
      join public.room_invites i
        on i.gallery_id = p_gallery and i.artist_id = a.owner_id and i.status = 'accepted'
     where a.id = p_artwork
  );
$$;

revoke all on function public.may_place_artwork(uuid, uuid) from public;
grant execute on function public.may_place_artwork(uuid, uuid) to authenticated, service_role;

-- `using` は今までどおり「部屋の所有者」だけにする（**読みと削除は絞らない** —
-- 招待を取り下げた後に、残った placement を消せなくなってしまう）。
-- 絞るのは `with check` = 新しく入る値だけ。
drop policy if exists "placements_owner_all" on public.placements;
create policy "placements_owner_all"
  on public.placements for all
  using (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.galleries g where g.id = gallery_id and g.owner_id = (select auth.uid()))
    and public.may_place_artwork(gallery_id, artwork_id)
  );

/* ================= 3. 取り下げたら壁から下りる ================= */
-- 受諾を取り消した（辞退に変えた・招待が消えた）のに作品が掛かったままなら、
-- 同意の意味が無い。作家が辞退した瞬間に、その部屋のその作家の placement を外す。
create or replace function public.drop_placements_on_revoke()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery uuid;
  v_artist uuid;
begin
  if tg_op = 'DELETE' then
    v_gallery := old.gallery_id; v_artist := old.artist_id;
  else
    -- 受諾のままなら何もしない
    if new.status = 'accepted' then return new; end if;
    if old.status is distinct from 'accepted' then return new; end if;
    v_gallery := new.gallery_id; v_artist := new.artist_id;
  end if;

  -- その部屋に掛かっている「この作家の作品」だけを外す。部屋の所有者自身の作品は
  -- ①で許されているので触らない。
  delete from public.placements p
   where p.gallery_id = v_gallery
     and exists (
       select 1 from public.artworks a
        where a.id = p.artwork_id
          and a.owner_id = v_artist
          and a.owner_id <> (select g.owner_id from public.galleries g where g.id = v_gallery)
     );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists room_invites_revoke on public.room_invites;
create trigger room_invites_revoke
  after update or delete on public.room_invites
  for each row execute function public.drop_placements_on_revoke();

/* ================= 4. 既存データの点検 ================= */
-- 既存の placement は全部「部屋の所有者＝作品の所有者」のはずだが、穴が空いていた
-- 期間があるので数えて報告する。0 以外が出たら、その部屋は**再公開のときに
-- upsert が弾かれる**（掛かったままにはならず、公開のやり直しで落ちる）ので、
-- どの行なのかを先に知りたい。
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.placements p
    join public.galleries g on g.id = p.gallery_id
    join public.artworks a on a.id = p.artwork_id
   where a.owner_id <> g.owner_id
     and not exists (
       select 1 from public.room_invites i
        where i.gallery_id = p.gallery_id and i.artist_id = a.owner_id and i.status = 'accepted'
     );
  if v_bad > 0 then
    raise warning '0037: % placements reference an artwork the room owner does not own and has no accepted invite for. They stay visible but will be rejected on the next republish — review them.', v_bad;
  else
    raise notice '0037: no cross-owner placements found (expected).';
  end if;
end $$;
