-- 作品枠の上限をDB側で強制する（ユーザー決定 2026-08-12・B案の第2段）
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）。**0058 を先に適用しておくこと。**
--
-- なぜ必要か: 上限はこれまで**ブラウザの中だけ**で守られていた。
--   ・作品の点数 … `app/me/page.tsx` の `onFiles` が数えるだけ。`/api/upload-url` は
--     保存容量（300MB）しか見ておらず、`artworks` に件数のトリガもポリシーも無かった。
--   ・配置の点数 … `PlacementEditor.drop()` が断るだけ。`placements` のトリガ（0037/
--     0041/0047）は同意取り消しで壁から下ろすもので、件数は数えていなかった。
-- 2026-08-12 に「手で並べた配置は枠で切り捨てない」（A案）へ直した結果、描画側の
-- 二重の網も無くなったので、**自分のログイン情報でAPIを直接叩けば上限を越えられる**
-- 状態になった。ユーザー選択B案に従い、DBを唯一の権威にする。
--
-- 数える単位は**口座全体**（`lib/limits.poolCapacityOf` と同じ意味）。部屋ごとの固定割りは
-- 2026-08-12 に撤廃したので、「その部屋の work_cap」で縛ると正しい操作を拒否する。
--
-- ### 判定は1か所に置く
-- DECISIONS【絶対ルール】2026-08-12「同じ意味の値を2か所で計算しない」に従い、
--   ・枠の合計       → `work_slot_pool()`
--   ・使っている点数 → `placement_pool_used()`
-- の2つだけを定義し、トリガと `replace_placements` の両方がそれを呼ぶ。
--
-- ### 「すでに上限を超えている部屋」を閉じ込めないこと（ここが一番の落とし穴）
-- 枠は**普通の操作で減る**:
--   ・部屋を削除する（`/me` の削除ボタン → 口座合計が 20 → 5 に落ちる）
--   ・合同展示から離脱する（0050 の `switch_room_expo` が `work_cap` を 15 → 5 に戻す）
-- どちらの後も、その部屋には減る前の点数が掛かったまま残る（A案で「配置したものを正と
-- する」と決めたので、勝手に下ろさない）。ここで厳密に `使用 <= 上限` を課すと、
-- **`replace_placements` が全行を書き直す形なので「作品を1点外す」保存すら拒否され、
-- オーナーが二度とその部屋を直せなくなる**。
-- なので規則は「**この操作が状況を悪くしていないこと**」にする:
--   使用 <= 上限   … 通常はこれ
--   使用 <= 操作前の使用 … 既に超えている場合は、増やさなければ通す（減らす・並べ替える
--                          のは常にできる）
-- 「操作前の使用」は `replace_placements` が delete の前に
-- `xibit.placement_baseline`（**トランザクション限りの設定**）へ書く。クライアントから
-- この名前の設定は触れない（PostgREST が公開するのは `request.*` だけ）。設定が無い＝
-- RPCを通らない直接の書き込みなので、その場合は 0 ＝**厳密に**判定する。
--
-- 作品（`artworks`）の側には猶予を置かない。insert しか見ないので、超えている人が
-- **新しく増やせない**のは正しい振る舞いで、削除は常にできる＝閉じ込めが起きない。

/* ================= 1. 判定の材料（この2つだけが権威） ================= */

-- 口座が持っている作品枠の合計。`lib/limits.poolCapacityOf` と同じ意味。
-- 下限を `5`（= `PLAN.worksPerGallery`。0038 が無料部屋の上限として使っている数字と同じ）
-- にしてあるのは、**部屋を1つも作っていない口座を締め出さないため**。`getMyGalleryRow`
-- は部屋が無ければ null を返す＝合計0になる口座が実在しうるので、素の合計で縛ると
-- 「招待されたので作品を上げたいが、部屋を作っていないので1点も上げられない」が起きる。
create or replace function public.work_slot_pool(p_owner uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(sum(g.work_cap), 0), 5)::int
    from public.galleries g
   where g.owner_id = p_owner;
$$;

-- 口座が**今**使っている配置の点数。同じ作品を2部屋に掛けたら2点として数える
-- （`lib/galleries.elsewherePlacedCount` が作品idで重複排除しないのと同じ理由 —
-- 消費するのは枠であって作品ではない）。
create or replace function public.placement_pool_used(p_owner uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.placements p
    join public.galleries g on g.id = p.gallery_id
   where g.owner_id = p_owner;
$$;

-- どちらも**トリガと `replace_placements` の中だけで使う**。誰にも grant しない
-- （`security definer` の関数は定義者の権限で走るので、トリガ経路には grant が要らない）。
-- 他人の口座の枠数や使用点数を問い合わせられるようにする理由が無い。
--
-- **`from public` だけでは外れない。** Supabase は `alter default privileges ... grant
-- execute on functions to anon, authenticated, service_role` を設定してあるので、
-- `public` スキーマに作った関数には**3ロールぶんの明示的な grant が最初から付く**
-- （`revoke ... from public` が消すのは PUBLIC の暗黙の grant だけ）。ロール名を並べて
-- 明示的に revoke する。※この穴は 0059 のSQLテスト22が実際に検出した。
revoke all on function public.work_slot_pool(uuid) from public, anon, authenticated, service_role;
revoke all on function public.placement_pool_used(uuid) from public, anon, authenticated, service_role;

-- 「操作前の使用点数」を申告する入口。**呼び手自身の分しか見ない**ので、これだけは
-- `authenticated` に開ける（引数が無いので他人の口座を指定できない）。
--
-- なぜ関数が要るか: `replace_placements` は `security definer` に**しない**設計
-- （0058 の要点。placements の RLS をそのまま効かせるため）なので、呼び手の権限で走る。
-- つまり上で revoke した `placement_pool_used` を直接は呼べない。数え方を
-- `replace_placements` の中に書き写せば呼べるが、それは同じ意味の値が2か所になる
-- （DECISIONS【絶対ルール】2026-08-12）。definer の入口を1つ挟むのが、数え方を1か所に
-- 保ったまま権限を閉じる唯一の形。
create or replace function public.note_placement_baseline()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config(
    'xibit.placement_baseline',
    public.placement_pool_used((select auth.uid()))::text,
    true  -- このトランザクション限り
  );
end;
$$;

revoke all on function public.note_placement_baseline() from public, anon, service_role;
grant execute on function public.note_placement_baseline() to authenticated;

/* ================= 2. 作品の点数 ================= */

create or replace function public.enforce_artwork_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_used int;
  v_pool int;
begin
  -- 1文で複数人ぶんが入ることは今の経路では無い（`insertArtworkRow` は1行ずつ）が、
  -- 所有者ごとに数えておけば将来の一括 insert でも正しい。
  for r in select distinct n.owner_id from new_rows n loop
    select count(*)::int into v_used from public.artworks a where a.owner_id = r.owner_id;
    v_pool := public.work_slot_pool(r.owner_id);
    if v_used > v_pool then
      raise exception 'work slot pool exceeded: % works for a pool of %', v_used, v_pool;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_artwork_pool() from public, anon, authenticated, service_role;

-- **statement 単位 + 遷移表**にしてある。行単位のトリガだと、1文で複数行入るときに
-- 「同じ文で入った行が見えるか」が直感に反しやすく、数え方が状況で変わる。
-- statement 単位なら文が終わった後の確定した状態を1回数えるだけで、安いし曖昧さが無い。
drop trigger if exists artworks_pool_limit on public.artworks;
create trigger artworks_pool_limit
  after insert on public.artworks
  referencing new table as new_rows
  for each statement execute function public.enforce_artwork_pool();

/* ================= 3. 配置の点数 ================= */

create or replace function public.enforce_placement_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_in_room int;
  v_used int;
  v_pool int;
  v_baseline int;
begin
  -- ① 1部屋の物理上限。どの間取りも 15 枠しか持たない（0038 が work_cap の上限として
  --    使っている数字と同じ）。これを超えた分は描画されないので実害は薄いが、
  --    「掛かっているのに見えない」行をDBに溜めない。
  for r in select distinct n.gallery_id from new_rows n loop
    select count(*)::int into v_in_room
      from public.placements p where p.gallery_id = r.gallery_id;
    if v_in_room > 15 then
      raise exception 'room slot limit exceeded: % placements in one room (max 15)', v_in_room;
    end if;
  end loop;

  -- ② 口座全体。冒頭の注記どおり「悪くしていないこと」で判定する。
  --
  -- **UPDATE では見ない。** `update placements set gallery_id = …` は行を部屋のあいだで
  -- 動かすだけで、RLS（0037）が移動元も移動先も所有者に限っているので**口座の合計は
  -- 動かせない**（他人の部屋へは移せない）。つまりここで見ても得るものが無く、
  -- 「既に超過している口座がまったく無害な UPDATE で拒否される」誤拒否だけが増える。
  -- 一方 ① の物理上限は UPDATE で破れる（別視点レビュー指摘 2026-08-13: A室の 0..14 と
  -- B室の 15 を B室へ寄せると16行になる）ので、そちらは UPDATE でも見る。
  if tg_op <> 'INSERT' then
    return null;
  end if;
  v_baseline := coalesce(nullif(current_setting('xibit.placement_baseline', true), ''), '0')::int;
  for r in
    select distinct g.owner_id
      from new_rows n join public.galleries g on g.id = n.gallery_id
  loop
    v_used := public.placement_pool_used(r.owner_id);
    v_pool := public.work_slot_pool(r.owner_id);
    if v_used > v_pool and v_used > v_baseline then
      raise exception 'work slot pool exceeded: % placements for a pool of %', v_used, v_pool;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_placement_pool() from public, anon, authenticated, service_role;

-- **UPDATE も見る**（物理上限だけ。理由は関数の中の注記）。アプリは `placements` を
-- 1か所も update していない（全部 select と、RPCの delete+insert）ので、これで拒否される
-- 正常な経路は無い。
--
-- **トリガは2本に分ける。** Postgres は「遷移表（`referencing new table`）は複数イベントの
-- トリガには付けられない」（`transition tables cannot be specified for triggers with more
-- than one event`）。関数は共有し、中で `tg_op` を見て役割を分ける。
drop trigger if exists placements_pool_limit on public.placements;
create trigger placements_pool_limit
  after insert on public.placements
  referencing new table as new_rows
  for each statement execute function public.enforce_placement_pool();

drop trigger if exists placements_room_limit_update on public.placements;
create trigger placements_room_limit_update
  after update on public.placements
  referencing new table as new_rows
  for each statement execute function public.enforce_placement_pool();

/* ================= 4. 操作前の点数を記録する（0058 の関数を置き換え） ================= */
-- 0058 との差は `set_config` の1文だけ。**判定はしない** — ここで数えたら、上の
-- トリガと合わせて規則が2か所になる（絶対ルール違反）。ここがやるのは「事実の申告」だけ。
create or replace function public.replace_placements(p_gallery uuid, p_rows jsonb)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  if not exists (
    select 1 from public.galleries g
     where g.id = p_gallery and g.owner_id = (select auth.uid())
  ) then
    raise exception 'replace_placements: not the owner of room %', p_gallery
      using errcode = '42501';
  end if;

  -- delete の**前**の点数を申告する（判定はトリガがやる）。
  perform public.note_placement_baseline();

  delete from public.placements where gallery_id = p_gallery;

  if p_rows is not null and jsonb_typeof(p_rows) = 'array' then
    insert into public.placements (
      gallery_id, artwork_id, slot_index,
      frame_override, mat_override, hanging_override, caption_override, light_override
    )
    select p_gallery,
           (r->>'artwork_id')::uuid,
           (r->>'slot_index')::int,
           r->>'frame_override',
           r->>'mat_override',
           r->>'hanging_override',
           r->>'caption_override',
           r->>'light_override'
      from jsonb_array_elements(p_rows) as r;
  end if;

  select count(*) into v_count from public.placements where gallery_id = p_gallery;
  return v_count;
end;
$$;

revoke all on function public.replace_placements(uuid, jsonb) from public, anon, service_role;
grant execute on function public.replace_placements(uuid, jsonb) to authenticated;
