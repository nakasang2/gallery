-- 配置の書き換えを1トランザクションにする（ユーザー決定 2026-08-12・B案の前提工事）
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）
--
-- なぜ必要か: これ単体では**振る舞いは1つも変わらない**。次の工程（枠の上限をDB側で
-- 強制する）を安全に載せるための土台。
--
-- 現状の `lib/galleries.rebuildPlacements` は
--   ① 新しい配置を upsert する（`on conflict (gallery_id, slot_index)`）
--   ② 使われなくなった slot の行を delete する
-- を**別々のHTTPリクエスト**で行う。つまり①と②のあいだの状態が**コミットされる**。
-- 作品を枠3から枠7へ動かすだけでも、その瞬間は枠3と枠7の両方に行がある＝15枠の
-- 部屋が一時的に16行になる。ここに「件数が上限以内か」を数えるトリガを置くと、
-- **正常な操作が拒否される** ── 過去2回起きた「配置タブでドラッグ&ドロップできない」
-- （LESSONS 2026-08-11・2026-08-12）と同じ形の不具合になる。
--
-- 関数は**呼び手のトランザクションの中で走る**ので、delete → insert を1つの原子的な
-- 置き換えにできる。従来 delete-then-insert を避けていた理由（「途中で失敗すると
-- 公開中の部屋が空になる」）は、原子的になった時点で消える。
--
-- **`security definer` にしない**（＝既定の invoker のまま）のが、この migration で
-- 最も大事な選択。placements の RLS は 0037 の `placements_owner_all` が
--   using      = その部屋の所有者
--   with check = 所有者 かつ `may_place_artwork`（自分の作品か、受諾済み招待がある作品）
-- を見ており、invoker ならこれが**そのまま**効く。definer にすると同じ判定をこの関数の
-- 中に書き写すことになり、招待や同意の仕様が変わったときに片方だけ古くなる
-- （DECISIONS【絶対ルール】2026-08-12「同じ意味の値を2か所で計算しない」）。
--
-- 掛かっている**他の作家の作品も一度消えて入れ直る**のは従来と同じ（②の delete も
-- 同じことをしていた）。呼び手が `guestArtworks` を省略すると自分で取り直す既定に
-- なっているのはこのため。

create or replace function public.replace_placements(p_gallery uuid, p_rows jsonb)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  -- 所有者かどうかを**先に**確かめて、はっきり失敗させる。RLS だけに任せると、
  -- 他人の部屋に空配列を渡したときに delete が 0 行・insert も 0 行で「成功」して
  -- 返ってしまい、呼び手は置き換えたと誤解する（黙って何もしないのが最悪の返り方）。
  if not exists (
    select 1 from public.galleries g
     where g.id = p_gallery and g.owner_id = (select auth.uid())
  ) then
    raise exception 'replace_placements: not the owner of room %', p_gallery
      using errcode = '42501';
  end if;

  delete from public.placements where gallery_id = p_gallery;

  -- 配列でないもの（null・オブジェクト）は「配置ゼロ」と同じ扱い。ここで例外に
  -- しないのは、`arrangement` が空の部屋を公開する経路が実際にあるため。
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

-- **`service_role` には渡さない**（このリポジトリの他のRPCとは違う）。この関数の先頭は
-- `auth.uid()` が部屋の所有者と一致することを要求するが、service_role の接続には
-- `request.jwt.claim.sub` が無いので `auth.uid()` は null ＝ **どう呼んでも
-- 「not the owner」で落ちる**。渡しておくと「service_role なら書ける」と読めてしまい、
-- 将来サーバ側から呼んだ人が理由の分からないエラーに当たる（別視点レビュー指摘）。
-- サーバ側から書く必要が出たら、そのとき意図して口を開ける。
revoke all on function public.replace_placements(uuid, jsonb) from public, anon, service_role;
grant execute on function public.replace_placements(uuid, jsonb) to authenticated;
