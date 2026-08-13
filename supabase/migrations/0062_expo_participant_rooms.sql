-- 合同展示を「参加作家ごとに部屋」の形にする（ユーザー決定 2026-08-13）
--
-- 背景: 招待→承諾のあと作家が触るUIが「受信箱の中の作品トレイ」という特殊な形で、
-- 通常の部屋編集（作品／部屋／配置／公開のタブ）と見た目も操作感も違いすぎるという
-- 指摘があった。ユーザー決定は次のとおり:
--   ①合同展示は「1展示につき1部屋」ではなく「1展示・1作家につき1部屋」に直す
--     （主催者も招待作家も同じ部屋を1つずつ持つ。0061の「1展示1部屋」を一部訂正）
--   ②招待を承諾した瞬間に、その作家自身の部屋を自動で作る
--   ③作家はその部屋を、通常展示と同じ「作品／部屋／配置／公開」タブで編集する。
--     「公開」は主催者だけ会期を選んで決済する画面のまま、**作家側は「準備できた」
--     トグルにする**（オンにすると主催者に通知が飛ぶ）。「参加者」タブは主催者専用のまま。
--   ④これに伴い、旧来の「作家が出す作品を選ぶ→主催者が自分の壁に掛ける」仕組み
--     （expo_submissions・受信箱の作品トレイ）は完全に置き換える。作家は自分の部屋に
--     自分で掛けるので、主催者が代わりに掛ける必要がない。表・関数は消さない
--     （既存データを壊さない）が、アプリからは呼ばなくなる。
--
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）。0044〜0061 を先に適用しておくこと。

/* ================= 1. artworks.gallery_id を安全な削除挙動にする ================= */
-- 0061 は `on delete cascade` にしていた。参加作家の部屋がこの先「招待が無くなれば
-- 自動で消える」対象になる（下の 5.）ため、部屋を消しても**アップロード済みの作品
-- そのものは失われない**よう `on delete set null` に変える（共有プールへ解放される、
-- `switch_room_expo` の「通常展示に戻す」と同じ考え方）。
alter table public.artworks drop constraint if exists artworks_gallery_id_fkey;
alter table public.artworks
  add constraint artworks_gallery_id_fkey
  foreign key (gallery_id) references public.galleries (id) on delete set null;

/* ================= 2. 通知の種類を1つ増やす ================= */
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite', 'invite_reply', 'invite_request', 'invite_approved',
                  'submission', 'unsubmit', 'room_ready', 'like', 'guestbook', 'announce'));

/* ================= 3. 部屋の上限: 「1展示1部屋」→「1展示・1作家1部屋」 ================= */
-- ①新規の部屋（INSERT経路）。**所有者チェックも緩める**: 主催者本人だけでなく、
-- その展示に**承諾済みの招待がある作家**も自分の部屋を作れるようにする。
create or replace function public.enforce_room_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free int;
  v_paid int;
  v_purchased int;
  v_expo_owner uuid;
begin
  if new.expo_id is not null then
    select owner_id into v_expo_owner from public.expos where id = new.expo_id;
    if v_expo_owner is distinct from new.owner_id then
      if not exists (
        select 1 from public.expo_invites i
         where i.expo_id = new.expo_id and i.artist_id = new.owner_id and i.status = 'accepted'
      ) then
        raise exception 'expo does not belong to this user' using errcode = 'check_violation';
      end if;
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
    -- 1展示・1作家1部屋（migration 0062。0061の「1展示1部屋」を訂正）。
    if exists (
      select 1 from public.galleries
       where expo_id = new.expo_id and owner_id = new.owner_id and id <> new.id
    ) then
      raise exception 'you already have a room in this exhibition' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = new.owner_id
     and expo_id is null;

  select count(*) into v_purchased
    from public.purchases
   where user_id = new.owner_id and kind = 'room';

  if new.slots_included then
    if v_paid >= v_purchased then
      raise exception 'no unused room purchase: % paid rooms, % purchased', v_paid, v_purchased
        using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 15 then
      raise exception 'work_cap % not allowed', new.work_cap using errcode = 'check_violation';
    end if;
  else
    if v_free >= 1 then
      raise exception 'the free room already exists' using errcode = 'check_violation';
    end if;
    if new.work_cap is not null and new.work_cap > 5 then
      raise exception 'work_cap % not allowed for the free room', new.work_cap
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ②既存の部屋を合同展示へ切り替える経路（`switch_room_expo`）。同じ2点を緩める:
-- 承諾済みの招待があれば主催者以外でも入れる／上限は「自分がこの展示に持っている部屋」で見る。
create or replace function public.switch_room_expo(p_gallery uuid, p_expo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_room_owner uuid;
  v_room_expo uuid;
  v_expo_owner uuid;
  v_placements int;
  v_free int;
  v_paid int;
  v_purchased int;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  select owner_id, expo_id into v_room_owner, v_room_expo
    from public.galleries where id = p_gallery;
  if v_room_owner is null then
    raise exception 'no such room';
  end if;
  if v_room_owner <> v_me then
    raise exception 'not your room';
  end if;

  if v_room_expo is not distinct from p_expo then
    return;
  end if;

  select count(*) into v_placements from public.placements where gallery_id = p_gallery;
  if v_placements > 0 then
    raise exception 'room is not empty' using errcode = 'check_violation';
  end if;

  if p_expo is not null then
    select owner_id into v_expo_owner from public.expos where id = p_expo;
    if v_expo_owner is distinct from v_me then
      if not exists (
        select 1 from public.expo_invites i
         where i.expo_id = p_expo and i.artist_id = v_me and i.status = 'accepted'
      ) then
        raise exception 'expo does not belong to this user' using errcode = 'check_violation';
      end if;
    end if;
    if not exists (
      select 1 from public.galleries
       where owner_id = v_me and expo_id is null and id <> p_gallery
    ) then
      raise exception 'cannot move your only room into a joint exhibition' using errcode = 'check_violation';
    end if;
    -- 1展示・1作家1部屋（migration 0062）。
    if exists (
      select 1 from public.galleries where expo_id = p_expo and owner_id = v_me and id <> p_gallery
    ) then
      raise exception 'you already have a room in this exhibition' using errcode = 'check_violation';
    end if;
    update public.galleries
       set expo_id = p_expo, slots_included = true, work_cap = 15
     where id = p_gallery;
    return;
  end if;

  select count(*) filter (where not slots_included),
         count(*) filter (where slots_included)
    into v_free, v_paid
    from public.galleries
   where owner_id = v_me and expo_id is null and id <> p_gallery;
  select count(*) into v_purchased from public.purchases
   where user_id = v_me and kind = 'room';

  if v_free = 0 then
    update public.galleries set expo_id = null, slots_included = false, work_cap = 5
     where id = p_gallery;
  elsif v_paid < v_purchased then
    update public.galleries set expo_id = null, slots_included = true, work_cap = 15
     where id = p_gallery;
  else
    raise exception 'no unused room purchase: buy a room first' using errcode = 'check_violation';
  end if;

  update public.artworks set gallery_id = null where gallery_id = p_gallery;
end;
$$;

/* ================= 4. 承諾した瞬間に、その作家自身の部屋を自動で作る ================= */
-- `expo_invites` への insert/update（status列）で発火。呼び手は `respondToInvite`
-- （直接UPDATE）・`request_expo_invite`／`approve_expo_request`（RPC内部のUPDATE）の
-- どれでもよい ── トリガにしたのはこの3経路すべてを1か所で確実に拾うため。
create or replace function public.create_room_on_expo_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_n int := 1;
  v_title text;
begin
  if new.status <> 'accepted' then return new; end if;
  if exists (
    select 1 from public.galleries where expo_id = new.expo_id and owner_id = new.artist_id
  ) then
    return new; -- 既にある（招き直し等）。二重に作らない。
  end if;

  select coalesce(nullif(x.title, ''), x.slug) into v_title from public.expos x where x.id = new.expo_id;

  -- 一意制約は (owner_id, slug)。展示idの先頭8桁 + 連番で、この作家の他の部屋と
  -- ぶつからない名前にする。
  loop
    v_slug := 'expo-' || substr(new.expo_id::text, 1, 8) || '-' || v_n;
    exit when not exists (
      select 1 from public.galleries where owner_id = new.artist_id and slug = v_slug
    );
    v_n := v_n + 1;
  end loop;

  insert into public.galleries (owner_id, expo_id, slug, title, slots_included, work_cap)
  values (new.artist_id, new.expo_id, v_slug, coalesce(v_title, ''), true, 15);
  return new;
end;
$$;

revoke all on function public.create_room_on_expo_accept() from public, anon, authenticated, service_role;

drop trigger if exists expo_invites_create_room on public.expo_invites;
create trigger expo_invites_create_room
  after insert or update of status on public.expo_invites
  for each row execute function public.create_room_on_expo_accept();

/* ================= 5. 辞退・取り消しで、作家自身の部屋も一緒に消える ================= */
-- 0047 の `drop_placements_on_expo_revoke` を差し替える。旧経路（主催者の壁に掛けた分・
-- expo_submissions）の後始末はそのまま残し、末尾に「作家自身の部屋を消す」を足す。
-- その部屋は招待がきっかけで自動で作られたものなので、招待が無くなれば一緒に消える
-- のが自然（1.の`on delete set null`により、アップロード済みの作品自体は失われない）。
create or replace function public.drop_placements_on_expo_revoke()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expo uuid;
  v_artist uuid;
begin
  if tg_op = 'DELETE' then
    v_expo := old.expo_id; v_artist := old.artist_id;
  else
    if new.status = 'accepted' then return new; end if;
    if old.status is distinct from 'accepted' then return new; end if;
    v_expo := new.expo_id; v_artist := new.artist_id;
  end if;

  -- 旧: 主催者の壁に掛かっていた分（提出モデル。後方互換のため経路は残す）。
  delete from public.placements p
   using public.galleries g, public.artworks a
   where p.gallery_id = g.id
     and g.expo_id = v_expo
     and a.id = p.artwork_id
     and a.owner_id = v_artist
     and a.owner_id <> g.owner_id;

  delete from public.expo_submissions s
   using public.artworks a
   where s.expo_id = v_expo
     and a.id = s.artwork_id
     and a.owner_id = v_artist;

  -- 新: 作家自身の部屋（migration 0062）。
  delete from public.galleries where expo_id = v_expo and owner_id = v_artist;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

/* ================= 6. 「準備できた」トグル（作家→主催者への通知） ================= */
alter table public.galleries add column if not exists expo_ready_at timestamptz;

create or replace function public.set_expo_room_ready(p_gallery uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_owner uuid;
  v_expo uuid;
  v_expo_owner uuid;
  v_expo_title text;
  v_artist text;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;

  select owner_id, expo_id into v_owner, v_expo from public.galleries where id = p_gallery;
  if v_owner is null then
    raise exception 'no such room';
  end if;
  if v_owner <> v_me then
    raise exception 'not your room';
  end if;
  if v_expo is null then
    raise exception 'not a joint-exhibition room' using errcode = 'check_violation';
  end if;

  update public.galleries
     set expo_ready_at = case when p_ready then now() else null end
   where id = p_gallery;

  if not p_ready then return; end if;

  select owner_id, title into v_expo_owner, v_expo_title from public.expos where id = v_expo;
  -- 主催者自身の部屋なら、自分に通知しない。
  if v_expo_owner is null or v_expo_owner = v_me then return; end if;

  select coalesce(display_name, username) into v_artist from public.profiles where id = v_me;
  perform public.push_notification(
    v_expo_owner, 'room_ready', p_gallery, null, coalesce(v_expo_title, ''), '', v_artist
  );
end;
$$;

revoke all on function public.set_expo_room_ready(uuid, boolean) from public, anon;
grant execute on function public.set_expo_room_ready(uuid, boolean) to authenticated;

/* ================= 7. 主催者が、自分の展示に居る部屋を一覧できる ================= */
-- `galleries_owner_all` は自分の行にしか効かない。ExpoManagerで「誰の部屋が
-- できているか」を見せるには、**その展示の主催者に限って**他の作家の部屋を
-- 読めるようにする必要がある（書き込みはできない — 更新系ポリシーは触っていない）。
drop policy if exists "galleries_select_expo_owner" on public.galleries;
create policy "galleries_select_expo_owner"
  on public.galleries for select
  using (
    expo_id is not null
    and exists (select 1 from public.expos x where x.id = expo_id and x.owner_id = (select auth.uid()))
  );
