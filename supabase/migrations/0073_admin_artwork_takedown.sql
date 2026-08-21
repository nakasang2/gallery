-- 管理者が作品単位で削除できるようにする（リリース前監査 #10・2026-08-21）
--
-- 何が問題だったか: 管理者が取れる措置は `admin_set_gallery_public`（0033）で
-- 部屋ごとisPublicを落とすことだけだった。R2上の実ファイルは消えず、通報者が
-- 貼ったURLはそのまま生き続ける（17 U.S.C. §512(c)(1)(C)の迅速削除要件を
-- 満たさない）。しかも部屋単位の措置しか無いため、合同展示で1点だけ侵害が
-- あっても無関係な参加作家の作品まで巻き添えで非公開になる。
--
-- ユーザー決定（2026-08-21）: 管理者が「作品単位」で実ファイルを削除できるAPIを
-- 追加する。ここに置くのはDB側の3つのRPC ──
--   ① `admin_list_gallery_artworks` — 管理者が対象の部屋（非公開でもよい）に
--     置かれている作品の一覧を見る。既存の `artworks_select_in_public_gallery`
--     （0001）は"公開"の部屋しか読めないため、通報対応で非公開化した後の部屋を
--     admin自身が覗けなくなる（`admin_set_gallery_public`と同じ
--     「クロスユーザーの1点だけ開けるRPC」パターン。0033参照）。
--   ② `admin_get_artwork_location` — DELETEせずに owner_id/storage_path だけ見る。
--     呼び出し元（app/api/admin/artwork-takedown）はこれで**R2側の実ファイルを
--     先に消してから**③でDB行を消す。逆の順序（行を先に消す）だと、R2側の削除が
--     途中で失敗したときに「DB上は存在しないが、R2には公開ファイルが残っている」
--     ── まさにこの機能が塞ごうとしているDMCA不備そのものが起き、しかも行が
--     無いので owner_id/storage_path を取り直す手段も無くなる（別視点レビューで
--     発見。2026-08-21）。
--   ③ `admin_takedown_artwork` — 対象作品を完全に削除する（R2側の削除が終わった
--     あとに呼ぶ）。`placements` は artwork_id に `on delete cascade`
--     （0001）なので、削除だけでどの部屋・合同展示に掛かっていても外れる。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create or replace function public.admin_list_gallery_artworks(p_gallery uuid)
returns table(id uuid, title text, storage_path text, kind text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_list_gallery_artworks: not authorised';
  end if;

  return query
  select a.id, a.title, a.storage_path, coalesce(a.kind, 'image')
    from public.artworks a
    join public.placements p on p.artwork_id = a.id
   where p.gallery_id = p_gallery
   order by p.slot_index;
end;
$$;

revoke all on function public.admin_list_gallery_artworks(uuid) from public;
grant execute on function public.admin_list_gallery_artworks(uuid) to authenticated;

create or replace function public.admin_get_artwork_location(p_artwork uuid)
returns table(owner_id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_get_artwork_location: not authorised';
  end if;

  return query
  select a.owner_id, a.storage_path from public.artworks a where a.id = p_artwork;
end;
$$;

revoke all on function public.admin_get_artwork_location(uuid) from public;
grant execute on function public.admin_get_artwork_location(uuid) to authenticated;

create or replace function public.admin_takedown_artwork(p_artwork uuid)
returns table(owner_id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_takedown_artwork: not authorised';
  end if;

  -- `placements` は artwork_id に `on delete cascade`（0001）なので、削除だけで
  -- どの部屋・合同展示に掛かっていても外れる。作品を完全に削除するのは、
  -- 「非表示フラグ」だと本人が公開設定を戻すだけで再び見えてしまうため
  -- （DMCA対応としては行の削除そのものが必要）。
  return query
  delete from public.artworks a
   where a.id = p_artwork
  returning a.owner_id, a.storage_path;
end;
$$;

revoke all on function public.admin_takedown_artwork(uuid) from public;
grant execute on function public.admin_takedown_artwork(uuid) to authenticated;
