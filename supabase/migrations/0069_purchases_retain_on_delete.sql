-- アカウント削除で購入台帳(purchases)を巻き添えにせず、法務ポリシーどおり保持する
-- （別視点レビュー 2026-08-20・監査で発見）
--
-- 背景: `purchases.user_id`（0016）は `references auth.users(id) on delete cascade`。
-- `delete_my_account()`（0007）は `auth.users` の行を削除するので、退会すると
-- `purchases` の全行がcascadeで消える。一方 `/privacy` §6 は「購入記録は税務・会計上
-- 必要な期間、アカウント削除後も保持する」と明記しており、実装が約束を守れていない。
-- 返金ポリシー（告知前12か月以内は返金）の検証や管理画面の売上集計も遡って狂う。
--
-- 方針: 個人識別子(user_id)だけを外し、行そのものは残す（匿名化）。同じ形の変更が
-- `artworks.gallery_id`（0062）に前例がある — 部屋を消してもアップロード済みの作品を
-- 失わないよう on delete cascade → on delete set null に変えている。
--
-- 影響の確認: `purchases_select_admin`/`read own purchases` ポリシーは
-- `user_id = auth.uid()` 系の一致判定なので、user_id が null になった行は誰の
-- auth.uid() とも一致せず、クライアント経由では読めなくなる(=正しい。個人と
-- 紐付けないことがそのまま「読めない」になる)。集計は admin.ts 側で service role
-- 経由・金額列(amount_jpy/currency)はそのまま残るので、総売上には影響しない。
-- UNIQUE (user_id, kind, item_key) は NULL 同士を別物として扱う(SQL標準)ので、
-- 退会後に同じメールで再登録して同じ商品を買っても衝突しない。
--
-- 保持期間そのもの(何年残すか・完全消去のタイミング)は法務要件次第 ── 要弁護士確認。
-- ここでは「即座に人を特定できなくする」ところまでを機械で担保する。
--
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

alter table public.purchases alter column user_id drop not null;

alter table public.purchases drop constraint if exists purchases_user_id_fkey;
alter table public.purchases
  add constraint purchases_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;
