\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**（他のテストや seed.sql に依存しない）。id は他とぶつからない帯。
-- 土台は 0036/0038 の番人に通る形で作る（無料の1室目は work_cap <= 5）。
insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-0000000000e1', 'host44@example.com'),
  ('e2000000-0000-0000-0000-0000000000e2', 'guest44@example.com'),
  ('e3000000-0000-0000-0000-0000000000e3', 'boss44@example.com');
update public.profiles set username='host44',  display_name='Host 44'  where id='e1000000-0000-0000-0000-0000000000e1';
update public.profiles set username='guest44', display_name='Guest 44' where id='e2000000-0000-0000-0000-0000000000e2';
update public.profiles set username='boss44',  display_name='Boss 44'  where id='e3000000-0000-0000-0000-0000000000e3';
insert into public.admins (user_id, note) values ('e3000000-0000-0000-0000-0000000000e3', 'test');

-- 主催者は通常展示も1室持っている（合同展示がその枠を食わないことを見るため）
insert into public.galleries (id, owner_id, slug, title, work_cap) values
  ('ea000000-0000-0000-0000-0000000000a1', 'e1000000-0000-0000-0000-0000000000e1', 'solo', 'Solo', 5);
-- 参加作家の作品（掃除で消えないことを見る）
insert into public.artworks (id, owner_id, title, width, height, storage_path) values
  ('ec000000-0000-0000-0000-0000000000c1', 'e2000000-0000-0000-0000-0000000000e2', 'Guest work', 1000, 800, 'g/1');

do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='expos')
    then raise exception 'HARNESS: expos が無い（0044 未適用）'; end if;
  if exists (select 1 from public.expos where owner_id='e1000000-0000-0000-0000-0000000000e1')
    then raise exception 'HARNESS: このテストの展示が既にある'; end if;
end $$;

\set ON_ERROR_STOP off
begin;

\echo '--- 作る（下書きは無料・非公開） ---'
savepoint s;
set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-0000000000e1';
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('ee000000-0000-0000-0000-0000000000e1', 'e1000000-0000-0000-0000-0000000000e1', 'spring-show', '春の合同展', 14);
\echo -n '01 主催者は展示を作れる: '
select coalesce(bool_and(slug='spring-show'), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '02 作った直後は会期が始まっていない（下書き）: '
select coalesce(bool_and(starts_at is null and ends_at is null), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '03 下書きは「見えている」ではない: '
select coalesce(bool_and(not public.expo_is_live(starts_at, ends_at)), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
reset role;

\echo '--- 支払いを通さずに公開できないこと（設計の一番の要点） ---'
set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-0000000000e1';
savepoint e;
\echo -n '04 主催者が starts_at を自分で入れる → '
update public.expos set starts_at = now() where id='ee000000-0000-0000-0000-0000000000e1';
rollback to e;
release e;
savepoint e;
\echo -n '05 service role 専用のRPCを呼ぶ → '
select public.record_expo_purchase('cs_x', 'e1000000-0000-0000-0000-0000000000e1',
  'ee000000-0000-0000-0000-0000000000e1', 14, 2500, 'usd');
rollback to e;
release e;
reset role;
\echo -n '06 上のどちらも効いていない（まだ下書き）: '
select coalesce(bool_and(starts_at is null), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';

\echo '--- 支払い＝公開 ---'
select public.record_expo_purchase('cs_spring_1', 'e1000000-0000-0000-0000-0000000000e1',
  'ee000000-0000-0000-0000-0000000000e1', 14, 2500, 'usd');
\echo -n '07 会期が始まった: '
select coalesce(bool_and(starts_at is not null), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '08 終わりは開始＋14日（トリガが必ず上書きする）: '
select coalesce(bool_and(ends_at = starts_at + interval '14 days'), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '09 いま見えている: '
select coalesce(bool_and(public.expo_is_live(starts_at, ends_at)), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '10 台帳に expo が1行（金額と通貨つき）: '
select coalesce(bool_and(amount_jpy=2500 and currency='usd' and item_key='ee000000-0000-0000-0000-0000000000e1'), false)
  from public.purchases where kind='expo' and sku='cs_spring_1';
\echo -n '11 webhook の再送で2重に入らない: '
select public.record_expo_purchase('cs_spring_1', 'e1000000-0000-0000-0000-0000000000e1',
  'ee000000-0000-0000-0000-0000000000e1', 14, 2500, 'usd');
select count(*)=1 from public.purchases where kind='expo' and sku='cs_spring_1';

\echo '--- 公開後は会期と名前を動かせない ---'
set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-0000000000e1';
savepoint e;
\echo -n '12 会期の長さを変える → '
update public.expos set duration_days = 30 where id='ee000000-0000-0000-0000-0000000000e1';
rollback to e;
release e;
savepoint e;
\echo -n '13 名前を変える → '
update public.expos set slug = 'other-name' where id='ee000000-0000-0000-0000-0000000000e1';
rollback to e;
release e;
\echo -n '14 題名は変えられる（会期に関係ない）: '
update public.expos set title = '春の合同展 2026' where id='ee000000-0000-0000-0000-0000000000e1';
select coalesce(bool_and(title='春の合同展 2026'), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
reset role;

\echo '--- 誰に見えるか ---'
savepoint v;
set local role anon;
-- **クレームも消す。** `reset role` はロールだけを戻し、`request.jwt.claim.sub` は
-- 残る ── そのままだと anon でも `auth.uid()` が直前の人を返し、所有者ポリシーが
-- 通ってしまう（実測 2026-08-09。「未ログインから下書きが見える」と誤診しかけた）。
set local "request.jwt.claim.sub" = '';
\echo -n '15 未ログインの来場者に見えている: '
select count(*)=1 from public.expos where id='ee000000-0000-0000-0000-0000000000e1';
reset role;
rollback to v;
release v;

-- 会期前の下書き。**ここで作って巻き戻さない** — あとの「下書きは掃除されない」でも使う。
-- （savepoint の中で作って rollback すると、以降の項目が「無いもの」を数えて
--  期待外れになる。実際に踏んだ。）
insert into public.expos (id, owner_id, slug, title) values
  ('ee000000-0000-0000-0000-0000000000e2', 'e1000000-0000-0000-0000-0000000000e1', 'draft-show', '下書き');
savepoint v;
set local role anon;
-- **クレームも消す。** `reset role` はロールだけを戻し、`request.jwt.claim.sub` は
-- 残る ── そのままだと anon でも `auth.uid()` が直前の人を返し、所有者ポリシーが
-- 通ってしまう（実測 2026-08-09。「未ログインから下書きが見える」と誤診しかけた）。
set local "request.jwt.claim.sub" = '';
\echo -n '16 下書きは未ログインからは見えない: '
select count(*)=0 from public.expos where id='ee000000-0000-0000-0000-0000000000e2';
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'e2000000-0000-0000-0000-0000000000e2';
\echo -n '17 下書きは他の作家からも見えない: '
select count(*)=0 from public.expos where id='ee000000-0000-0000-0000-0000000000e2';
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'e3000000-0000-0000-0000-0000000000e3';
\echo -n '18 管理者からは見える: '
select count(*)=1 from public.expos where id='ee000000-0000-0000-0000-0000000000e2';
reset role;
rollback to v;
release v;

\echo '--- 部屋枠を消費しないこと ---'
\echo -n '19 合同展示の部屋は購入が無くても作れる（場所代で払っている）: '
insert into public.galleries (id, owner_id, slug, title, expo_id, work_cap)
  values ('ea000000-0000-0000-0000-0000000000a2', 'e1000000-0000-0000-0000-0000000000e1',
          'expo-room', 'Expo room', 'ee000000-0000-0000-0000-0000000000e1', 15);
select count(*)=1 from public.galleries where id='ea000000-0000-0000-0000-0000000000a2';
savepoint e;
\echo -n '20 通常の部屋は今までどおり購入が要る → '
insert into public.galleries (owner_id, slug, title, slots_included, work_cap)
  values ('e1000000-0000-0000-0000-0000000000e1', 'paid-room', 'Paid', true, 15);
rollback to e;
release e;
savepoint e;
\echo -n '21 無料の2室目も今までどおり弾かれる → '
insert into public.galleries (owner_id, slug, title, work_cap)
  values ('e1000000-0000-0000-0000-0000000000e1', 'free2', 'Free 2', 5);
rollback to e;
release e;

\echo '--- 会期の長さ ---'
savepoint e;
\echo -n '22 認められていない長さは拒否 → '
-- **存在する展示**を使う（存在しないidだと「no such expo」で落ちて、長さの検査を
-- 通ったかどうか分からない＝空振りになる）。
select public.record_expo_purchase('cs_bad', 'e1000000-0000-0000-0000-0000000000e1',
  'ee000000-0000-0000-0000-0000000000e1', 21, 3000, 'usd');
rollback to e;
release e;
savepoint e;
\echo -n '23 他人の展示に払わせられない → '
select public.record_expo_purchase('cs_other', 'e2000000-0000-0000-0000-0000000000e2',
  'ee000000-0000-0000-0000-0000000000e1', 14, 2500, 'usd');
rollback to e;
release e;

\echo '--- 猶予と掃除 ---'
savepoint p;
-- 会期を過去にずらす（テストのため直接書く。トリガは authenticated だけを見るので
-- postgres からは動かせる ── 本番でこの経路を通るのは webhook だけ）。
update public.expos set starts_at = now() - interval '20 days'
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '24 会期は終わっている（14日 + 6日前に開始 → 終了済み）: '
select coalesce(bool_and(public.expo_has_ended(ends_at)), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '25 猶予(7日)の中なのでまだ見えている: '
select coalesce(bool_and(public.expo_is_live(starts_at, ends_at)), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '26 猶予の中は掃除されない: '
select public.purge_expired_expos()=0;
update public.expos set starts_at = now() - interval '30 days'
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '27 猶予を過ぎたら見えない: '
select coalesce(bool_and(not public.expo_is_live(starts_at, ends_at)), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '28 掃除で消える: '
select public.purge_expired_expos()>=1;
\echo -n '29 展示が消えた: '
select count(*)=0 from public.expos where id='ee000000-0000-0000-0000-0000000000e1';
\echo -n '30 合同展示の部屋も一緒に消えた: '
select count(*)=0 from public.galleries where id='ea000000-0000-0000-0000-0000000000a2';
\echo -n '31 **参加作家の作品は残っている**（消えるのは展示・部屋・配置だけ）: '
select count(*)=1 from public.artworks where id='ec000000-0000-0000-0000-0000000000c1';
\echo -n '32 主催者の通常の部屋は無傷: '
select count(*)=1 from public.galleries where id='ea000000-0000-0000-0000-0000000000a1';
\echo -n '33 消えたので同じ名前で立て直せる: '
insert into public.expos (owner_id, slug, title) values
  ('e1000000-0000-0000-0000-0000000000e1', 'spring-show', '春の合同展（第2回）');
select count(*)=1 from public.expos where slug='spring-show';
\echo -n '34 下書きは掃除されない: '
select count(*)=1 from public.expos where id='ee000000-0000-0000-0000-0000000000e2';
rollback to p;
release p;

\echo '--- 名前 ---'
savepoint n;
savepoint e;
\echo -n '35 同じ名前は2つ作れない → '
insert into public.expos (owner_id, slug, title) values
  ('e2000000-0000-0000-0000-0000000000e2', 'spring-show', '横取り');
rollback to e;
release e;
rollback to n;
savepoint n;
savepoint e;
\echo -n '36 大文字違いも同じ名前として弾く → '
insert into public.expos (owner_id, slug, title) values
  ('e2000000-0000-0000-0000-0000000000e2', 'Spring-Show', '横取り');
rollback to e;
release e;
rollback to n;
savepoint n;
savepoint e;
\echo -n '37 形式が違う名前は拒否 → '
insert into public.expos (owner_id, slug, title) values
  ('e2000000-0000-0000-0000-0000000000e2', 'ab', '短すぎ');
rollback to e;
release e;
rollback to n;
release n;

\echo '--- 他人の展示を触れないこと ---'
savepoint o;
set local role authenticated;
set local "request.jwt.claim.sub" = 'e2000000-0000-0000-0000-0000000000e2';
update public.expos set title='乗っ取り' where id='ee000000-0000-0000-0000-0000000000e1';
delete from public.expos where id='ee000000-0000-0000-0000-0000000000e1';
reset role;
\echo -n '38 他人は題名を変えられない・消せない: '
select coalesce(bool_and(title='春の合同展 2026'), false) from public.expos
  where id='ee000000-0000-0000-0000-0000000000e1';
rollback to o;
release o;

rollback;
