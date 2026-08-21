-- 作品のstorage_pathがなりすませる穴を塞ぐ（リリース前監査 #32・2026-08-21）
--
-- 何が問題だったか: `artworks_owner_all`（0001）は `owner_id = auth.uid()` しか
-- 見ておらず、`storage_path` に何を書き込むかを検査しない。クライアント
-- （lib/cloud.ts）は本来 `storage_path` を必ず `{owner_id}/{id}` の形で送るが、
-- それはアプリのコードがそう組み立てているだけで、DB側では強制されていない。
-- 細工したクライアントが自分のowner_idのまま `storage_path` に他人のuuidの
-- フォルダ（R2は公開バケットなので誰でもGETできる）を指定してinsertでき、
-- 他人がアップロード済みの画像を自分の作品として表示できてしまう
-- （なりすまし帰属）。
--
-- 同じ種類の穴は `theme`/`layout`（0068 `guard_theme_layout_change`）で
-- 塞いだのと同型 ── 列専用の `before insert or update` トリガで、値を
-- クライアントの言い分どおりに信用しないようにする。
--
-- `storage_path` は常に `{owner_id}/{id}` のみを許可する。アプリのどの経路も
-- これ以外の値を書いたことはない（lib/cloud.ts uploadArtwork/uploadVideoArtwork
-- が唯一の書き込み元）ので、正当な操作を壊さない。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

create or replace function public.guard_artwork_storage_path()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- service_role等（admin_takedown_artworkのdeleteや、将来のバッチ処理）は
  -- 素通りさせる。PostgREST経由で artworks.storage_path/owner_id を書けるのは
  -- 'authenticated'/'anon' だけ（guard_theme_layout_changeと同じ作法。0068参照）。
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.storage_path is distinct from (new.owner_id::text || '/' || new.id::text) then
    raise exception 'storage_path must be the owner''s own folder'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists artworks_guard_storage_path on public.artworks;
create trigger artworks_guard_storage_path
  before insert or update of storage_path, owner_id on public.artworks
  for each row execute function public.guard_artwork_storage_path();
