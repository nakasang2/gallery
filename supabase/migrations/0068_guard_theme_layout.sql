-- 有料テーマ/レイアウトを購入なしで設定できてしまう穴を塞ぐ（別視点レビュー 2026-08-20・監査で発見）
--
-- 背景: `galleries_owner_all`（0001）は `owner_id = auth.uid()` しか見ておらず、
-- `theme`/`layout` 列に何を書き込むかを一切検査しない。`isThemeUnlocked`/`isLayoutUnlocked`
-- （lib/entitlements）はUIコンポーネントの中でしか呼ばれておらず、DBへの書き込み経路には
-- 存在しない。結果、ログイン済みユーザーがブラウザのコンソールから
--   supabase.from('galleries').update({ theme: 'noir', layout: 'portrait' }).eq('id', 自分の部屋)
-- を直接実行するだけで、$8のテーマや$5のレイアウトを無料で設定できた。
--
-- 同じ種類の穴は `work_cap`（0036 `guard_work_cap_raise`）・`slots_included`
-- （0038 `guard_room_grade`）・`expo_id`（0050 `galleries_guard_expo_switch`）では
-- 既に列専用のガードトリガで塞がれている。`theme`/`layout` だけがこのパターンから
-- 漏れていた。
--
-- 何を「所有」とみなすか: `purchases` に (kind='theme'|'layout', item_key=値) の行が
-- あるか、または forever-free（lib/entitlements の FOREVER_FREE_THEME_IDS=['whitecube'] /
-- FOREVER_FREE_LAYOUT_IDS=['corridor']。**あちらと同じ理由でハードコードのスナップショット**
-- ── 将来のテーマ/レイアウトを自動でタダにしないため、増えたら手で追記する）。
--
-- 例外が必要な正当なケース: `createGallery`（lib/galleries.ts）は2室目以降を作るとき、
-- 既存のメイン部屋の見た目をコピーする（「テーマ/レイアウトはアカウント単位の所有物、
-- 部屋ごとの設定は見た目の選択」という設計・ユーザー決定 2026-08-09）。コピー元が
-- 大昔からある行（決済導入前の 'chic' など、購入記録が無いまま存在する値）でも、
-- **その値は既にこのアカウントのどこかの部屋に出ている**ので新たに何かを解禁するわけ
-- ではない。よって「購入済み」に加えて「自分の別の部屋に既にその値がある」も許可条件に
-- 加える（このガード導入前からの値を持つアカウントの正当な操作を壊さないため）。
--
-- **この「自分の別の部屋に既にある」はINSERT（新しい部屋を作るとき）に限る。**
-- UPDATEにも効かせると、購入記録の無い値を持つ部屋を1つ持っているだけで、authenticated
-- がその値を**他の全部屋へ複製**でき（update galleries set theme=X where id=別の部屋）、
-- 未購入の値がアカウント全体に広がってしまう（別視点レビューで実測・発見）。新しい部屋を
-- 「今の見た目を引き継いで作る」ことと、既存の部屋を「よそにある値へ書き換える」ことは
-- 権限としてまったく別物 — 前者だけを許す。
--
-- 変更のあった列だけ検査する（`new.theme is distinct from old.theme` 等）。触っていない
-- 列は再検査しない ── そうしないと、購入記録の無い古い値を持つ行が、無関係な列
-- （layoutだけ等）を更新しただけで巻き添えで拒否される（既存データを壊さない方針）。
--
-- 副作用として見つけた不整合: `galleries.theme`/`.layout` の列DEFAULT（0001）は
-- 'chic'/'hall' ── どちらも**有料**の値だった。アプリ側(`createGallery`)は必ず
-- 明示的にtheme/layoutを指定する（初回はwhitecube/corridor、2室目以降は自分の
-- メイン部屋のコピー）ので今まで実害は無かったが、列だけを指定する直接insertが
-- あれば有料値が無料で入ってしまう地雷だった。実際に本テスト群のfixtureがこの
-- デフォルト任せで、このガードを足したことで初めて表面化した（列を1つ足すたびに
-- 都度直すのではなく、根のズレを直す）。無料側の値に揃える。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

alter table public.galleries alter column theme set default 'whitecube';
alter table public.galleries alter column layout set default 'corridor';

create or replace function public.guard_theme_layout_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  theme_changed boolean;
  layout_changed boolean;
begin
  -- 購入付与（webhook）・admin付与（grant_entitlement）はどちらも galleries を
  -- 直接触らず purchases に行を足すだけ。galleries.theme/layout を書けるのは
  -- PostgREST 経由の 'authenticated'/'anon' だけなので、それ以外（service_role等）
  -- はここでは素通りさせる（guard_work_cap_raise と同じ作法。0036 参照）。
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    theme_changed := true;
    layout_changed := true;
  else
    theme_changed := new.theme is distinct from old.theme;
    layout_changed := new.layout is distinct from old.layout;
  end if;

  if theme_changed and new.theme <> 'whitecube'
     and not exists (
       select 1 from public.purchases
        where user_id = new.owner_id and kind = 'theme' and item_key = new.theme
     )
     and not (
       tg_op = 'INSERT' and exists (
         select 1 from public.galleries
          where owner_id = new.owner_id and theme = new.theme
       )
     )
  then
    raise exception 'theme is unlocked by purchase only: %', new.theme
      using errcode = 'check_violation';
  end if;

  if layout_changed and new.layout <> 'corridor'
     and not exists (
       select 1 from public.purchases
        where user_id = new.owner_id and kind = 'layout' and item_key = new.layout
     )
     and not (
       tg_op = 'INSERT' and exists (
         select 1 from public.galleries
          where owner_id = new.owner_id and layout = new.layout
       )
     )
  then
    raise exception 'layout is unlocked by purchase only: %', new.layout
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists galleries_guard_theme_layout on public.galleries;
create trigger galleries_guard_theme_layout
  before insert or update of theme, layout on public.galleries
  for each row execute function public.guard_theme_layout_change();
