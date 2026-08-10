\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

-- **自己完結**。id は他とぶつからない帯（0049 の帯）。
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-0000000000f1', 'host49@example.com'),
  ('f2000000-0000-0000-0000-0000000000f2', 'victim49@example.com');
update public.profiles set username='host49',   display_name='Host 49'   where id='f1000000-0000-0000-0000-0000000000f1';
update public.profiles set username='victim49', display_name='Victim 49' where id='f2000000-0000-0000-0000-0000000000f2';

-- 被害者は実際に決済済み（service role で record_expo_purchase と同じ形を作る）。
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('ef000000-0000-0000-0000-0000000000f2', 'f2000000-0000-0000-0000-0000000000f2', 'victim-expo-49', '被害者の展示', 30);
update public.expos set starts_at = now() where id='ef000000-0000-0000-0000-0000000000f2';

\set ON_ERROR_STOP off
begin;

\echo '--- バグ①: INSERTで starts_at を自分で入れて無料公開できないこと ---'
savepoint e;
set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-0000000000f1';
\echo -n '01 作成と同時に starts_at を入れる → '
insert into public.expos (owner_id, slug, title, duration_days, starts_at)
  values ('f1000000-0000-0000-0000-0000000000f1', 'free-attack-49', 'Free Attack', 30, now());
rollback to e;
release e;
reset role;
\echo -n '02 上の攻撃は入っていない（無料公開されていない）: '
select coalesce(bool_and(false), true) from public.expos where slug='free-attack-49';

savepoint e;
set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-0000000000f1';
\echo -n '03 starts_at を入れなければ今までどおり下書きは作れる: '
insert into public.expos (id, owner_id, slug, title, duration_days) values
  ('ef000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000f1', 'host-draft-49', '主催者の下書き', 14);
select coalesce(bool_and(starts_at is null), false) from public.expos
  where id='ef000000-0000-0000-0000-0000000000f1';
reset role;

\echo '--- バグ②: 他人の展示IDを付けて無料・無制限の部屋を作れないこと ---'
savepoint e;
set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-0000000000f1';
\echo -n '04 被害者の展示IDで部屋を作る（ただ乗り）→ '
insert into public.galleries (owner_id, expo_id, slug, title, work_cap, slots_included)
  values ('f1000000-0000-0000-0000-0000000000f1', 'ef000000-0000-0000-0000-0000000000f2',
          'freeload-49', 'ただ乗り', 15, true);
rollback to e;
release e;
reset role;
\echo -n '05 上の攻撃は入っていない（被害者の展示に部屋が増えていない）: '
select coalesce(bool_and(false), true) from public.galleries where slug='freeload-49';

savepoint e;
set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-0000000000f1';
\echo -n '06 自分の下書き展示IDでも work_cap を15超で作れない → '
insert into public.galleries (owner_id, expo_id, slug, title, work_cap, slots_included)
  values ('f1000000-0000-0000-0000-0000000000f1', 'ef000000-0000-0000-0000-0000000000f1',
          'huge-cap-49', '容量無制限', 999999, true);
rollback to e;
release e;
reset role;

savepoint e;
set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-0000000000f1';
\echo -n '07 自分の展示IDに work_cap=15 なら今までどおり作れる（回帰なし）: '
insert into public.galleries (id, owner_id, expo_id, slug, title, work_cap, slots_included)
  values ('eb000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000f1',
          'ef000000-0000-0000-0000-0000000000f1', 'legit-room-49', '主催者の部屋', 15, true);
select coalesce(bool_and(work_cap=15), false) from public.galleries
  where id='eb000000-0000-0000-0000-0000000000f1';
reset role;

rollback;
