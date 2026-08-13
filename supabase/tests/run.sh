#!/bin/bash
# RLS・トリガ・RPC を**素のPostgres**で検証する（Supabaseは要らない）。
#
#   supabase/tests/run.sh                      # 全migration + 全テスト
#   supabase/tests/run.sh 0042_notifications   # 1本だけ
#   supabase/tests/run.sh --pending 0036       # 「0035まで適用済みのDB」に0036以降を当てる
#
# なぜこれが要るか: このリポジトリの守りの大半は**DBの中**にある（RLSポリシー・
# security definer のトリガ・購入台帳を数える番人）。型チェックもビルドも画面も、
# それらが正しいかを何も言わない。実際に:
#   ・0041 は「未ログインの来場者から公開サイトが全滅する」状態で push された
#     （テスト35項目が全部 authenticated で走っていて気づかなかった）
#   ・0039+0040 は「2回流すと消したはずの列が復活する」状態だった
# どちらも**ここで流せば10秒で出る**。
#
# 必要なもの: postgresql（16で検証）。macOS なら `brew install postgresql@16`。
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb || echo /usr/lib/postgresql/16/bin/initdb)")}"
WORK="${WORK:-/tmp/xibit-sqltest}"
PORT="${PORT:-55442}"

PENDING_FROM=""
if [ "$1" = "--pending" ]; then PENDING_FROM="$2"; shift 2; fi
ONLY="$1"

# ---- サーバを立てる（使い捨て） ----
if ! "$PGBIN/pg_ctl" -D "$WORK/data" status >/dev/null 2>&1; then
  rm -rf "$WORK"; mkdir -p "$WORK"
  "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
  "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK" -l "$WORK/log" start >/dev/null
  sleep 2
fi
P="psql -h $WORK -p $PORT -U postgres"

fresh() { # $1 = db名
  $P -d postgres -q -c "drop database if exists $1" -c "create database $1" 2>/dev/null
  # **スタブ→権限→migration の順**。Supabase は `alter default privileges` で
  # 「これから作られる表」にも権限を配るので、その順序を再現しないと migration が
  # あとで作った表に権限が付かず「permission denied for table」で本番と違う結果になる。
  $P -d "$1" -v ON_ERROR_STOP=1 -q -f "$HERE/stubs.sql"
}

apply_range() { # $1=db  $2=開始番号  $3=終了番号
  for f in "$ROOT"/supabase/migrations/*.sql; do
    n=$(basename "$f" | cut -c1-4)
    [ "$n" \< "$2" ] && continue
    [ -n "$3" ] && [ "$n" \> "$3" ] && continue
    # **エラーを1つも無視しない。** 以前 `grep -v` でエラーを捨てていたせいで、
    # 0001 の途中で止まった「後半が未適用のDB」を相手に検査していた。
    #
    # **パイプで psql の終了状態を捨てないこと。** ここは長らく
    # `psql … | grep -v NOTICE || true` で、パイプラインの状態＝最後の `grep`／`true` に
    # なるため **migration が途中で落ちても静かに次へ進んでいた**（実測 2026-08-10:
    # 0047 の `drop function` が依存関係で落ち、表だけ消えて関数とポリシーが残った
    # 半端なDBを相手に43項目を検査していた）。出力は変数で受けて、状態を自分で見る。
    local out
    if ! out=$($P -d "$1" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
      echo "$out"
      echo "✗ migration $(basename "$f") が途中で落ちました（この先の検査は嘘になるので止めます）"
      exit 1
    fi
    # NOTICE は量が多いので伏せる。WARNING と、その他の出力はそのまま見せる。
    echo "$out" | grep -v NOTICE || true
  done
}

if [ -n "$PENDING_FROM" ]; then
  prev=$(printf '%04d' $((10#$PENDING_FROM - 1)))
  echo "### 0001〜$prev を適用（本番の現状を再現）＋既存データ"
  fresh pending_test
  apply_range pending_test 0000 "$prev"
  $P -d pending_test -v ON_ERROR_STOP=1 -q -f "$HERE/seed.sql"
  echo "### $PENDING_FROM 以降を**3回**当てる（冪等: 貼り直しで壊れないこと）"
  for i in 1 2 3; do apply_range pending_test "$PENDING_FROM" ""; done
  echo "### schema.sql 1枚で作ったDBとスキーマが一致するか"
  fresh from_schema
  $P -d from_schema -q -f "$ROOT/supabase/schema.sql" >/dev/null 2>&1
  for db in pending_test from_schema; do
    "$PGBIN/pg_dump" -h "$WORK" -p "$PORT" -U postgres --schema-only --schema=public -d "$db" \
      | grep -v '^\\\(un\)\?restrict ' > "$WORK/dump_$db.sql"
  done
  if diff -q "$WORK/dump_pending_test.sql" "$WORK/dump_from_schema.sql" >/dev/null; then
    echo "→ 完全一致"
  else
    echo "→ 差分あり:"; diff "$WORK/dump_pending_test.sql" "$WORK/dump_from_schema.sql" | head -40; exit 1
  fi
  exit 0
fi

# ---- 通常: 全migration を当ててからテストを流す ----
echo "### 全 migration を適用"
fresh app
apply_range app 0000 ""
$P -d app -q -c "
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated, anon;" >/dev/null 2>&1
# **共通の土台は入れない。各テストが自分で作る。** `seed.sql` は「0035時代に既にあった
# データ」なので、全migration適用後のDBに入れると 0038 の番人（無料部屋は1室まで）に
# 正しく弾かれる ── seed.sql は `--pending`（冪等検証）専用。

fail=0
for t in "$HERE"/[0-9]*.sql; do
  name=$(basename "$t" .sql)
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
  echo; echo "### $name"
  # テスト本体は自分で seed して rollback するので、DBは使い回してよい
  out=$($P -d app -f "$t" 2>&1)
  echo "$out" | grep -Ev '^(SET|RESET|SAVEPOINT|ROLLBACK|RELEASE|BEGIN|INSERT|UPDATE|DELETE|SELECT|DO|Output|Tuples|[0-9a-f]{8}-)' \
    | grep -v '^CONTEXT' | grep -v '^ *$' | sed 's/^/  /'
  # 判定は **`scripts/sql-verdict.mjs`** に出してある（`node scripts/check-gates.mjs`
  # が合成出力を流して「本当に検出するか」を試験できるように）。ここで grep を書いて
  # いたときに、ラベルと値のあいだに `INSERT 0 1` が挟まった形の `f` を取りこぼした。
  printf '%s' "$out" > "$WORK/out.txt"
  # テスト名を渡す。判定器は「何も検査していない項目」の基準線
  # （`scripts/sql-vacuous-baseline.json`）を `ファイル名|番号` で引くので、
  # ここで名前を渡さないと全部 `?` になり基準線が空振りする。
  if ! node "$ROOT/scripts/sql-verdict.mjs" "$WORK/out.txt" "$name"; then fail=1; fi
done

echo
if [ "$fail" = 0 ]; then echo "SQL テスト: すべて期待どおり"; else echo "SQL テスト: 落ちた項目あり"; exit 1; fi
