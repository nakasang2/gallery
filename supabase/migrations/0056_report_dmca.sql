-- 通報に DMCA §512(c)(3) の法定要件を記録できるようにする（ユーザー決定 2026-08-12・D-4）
-- 適用方法: SQL Editor に貼り付けて Run（再実行安全）
--
-- なぜ必要か: `/report` は「対象・理由・連絡先（任意）」しか受け取っておらず、
-- 米国 17 U.S.C. §512(c)(3) が有効な削除通知に要求する要素——①申立人の氏名と署名
-- ②対象の著作物の特定 ③善意の申立ての表明 ④偽証罰の下での正確性・権限の宣誓——を
-- どれも受け取っていなかった。受け取っていない＝有効な通知が1件も届いていない状態で、
-- セーフハーバー（§512）の前提が成立しない。
--
-- 通報は著作権だけではない（嫌がらせ・違法な内容も同じ入口）。嫌がらせの報告に
-- 偽証罰の宣誓を求めるのは筋が違うので、**種別を持たせて著作権のときだけ要求する**。
-- その「種別ごとに要求が変わる」を check 制約でDB側にも書いてある——UIだけの検証は、
-- 別の経路（RLSのinsertは誰でも通る）から素通りできるため。

alter table public.reports
  -- 通報の種別。既存行は 'other'（種別を持たない時代のもの）
  add column if not exists kind text not null default 'other',
  -- 申立人の氏名（§512(c)(3)(A)(i) の署名にあたる。電子署名＝本人が入力した氏名）
  add column if not exists claimant text not null default '' check (char_length(claimant) <= 200),
  -- 侵害されたとする著作物の特定（§512(c)(3)(A)(ii)）
  add column if not exists work_identified text not null default '' check (char_length(work_identified) <= 1000),
  -- 善意の申立て＋偽証罰の下での宣誓に同意したか（§512(c)(3)(A)(v)(vi)）
  add column if not exists sworn boolean not null default false;

-- 種別の許可リスト。`if not exists` が使えない制約なので drop してから作る（再実行安全）
alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports
  add constraint reports_kind_check
  check (kind in ('copyright', 'harassment', 'illegal', 'other'));

-- 著作権の通報だけ、法定要件が揃っていることを要求する。
-- **既存行を壊さないために `not valid` にしてある** — 既存の通報は kind='other' なので
-- この制約に当たらないが、`add constraint` は既定で全行を検査するため、万一 kind を
-- 手で書き換えた行があると適用そのものが失敗する。新しい行にだけ効かせれば足りる。
alter table public.reports drop constraint if exists reports_dmca_complete;
alter table public.reports
  add constraint reports_dmca_complete
  check (
    kind <> 'copyright'
    or (sworn and char_length(claimant) > 0 and char_length(work_identified) > 0)
  ) not valid;

-- 閲覧ポリシーは引き続き作らない（運用者が service role / SQL Editor で見る）。
-- insert ポリシー `reports_insert_any` は 0010 のまま——誰でも通報できる状態を保つ。
-- **申立人の氏名と連絡先は個人情報**なので、来場者向けの select を開けてはいけない。
