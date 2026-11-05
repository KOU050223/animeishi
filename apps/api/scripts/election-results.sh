#!/usr/bin/env bash
# 総選挙（issue #438）の結果集計を wrangler d1 execute 経由で出す運営用
# スクリプト。途中経過はユーザーに公開しないが、運営は終了後に結果を
# 特集記事（issue #437 の仕組み）に載せるため、ここで集計を取り出す。
# 読み取り専用（SELECT のみ）。
#
# 使い方:
#   scripts/election-results.sh [--env production|preview | --local] <slug>
#
# 既定の接続先は本番（--env production）。--local は wrangler dev が使う
# ローカル D1。出力は得票数の多い順（同数は frontmatter の candidates の
# 並び順）。総得票数も合わせて出す。
set -euo pipefail

# wrangler.toml は apps/api にあるため、どこから呼んでもそこで実行する。
# help() が冒頭コメントを $0 から読むため、cd 前に絶対パスに解決しておく
# （reports.sh と同じ考え方）。
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT_PATH")/.."

help() {
  sed -n '2,16p' "$SCRIPT_PATH"
}

ENV="production"
LOCAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --local) LOCAL=1; shift ;;
    --env) ENV="${2:?--env には production|preview を指定}"; shift 2 ;;
    --env=*) ENV="${1#*=}"; shift ;;
    -h | --help) help; exit 0 ;;
    *) break ;;
  esac
done

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  help >&2
  exit 1
fi

DB_NAME="animeishi-db"
D1_TARGET=(--remote --env "$ENV" -y)
if [ "$LOCAL" = 1 ]; then
  D1_TARGET=(--local)
elif [ "$ENV" = "preview" ]; then
  DB_NAME="animeishi-db-preview"
elif [ "$ENV" != "production" ]; then
  echo "不明な --env: ${ENV}（production|preview のみ）" >&2
  exit 1
fi

# slug は単一引用符を二重化して SQL リテラルに埋め込む（reports.sh と同じ）。
sql_literal() {
  local escaped
  escaped="$(printf '%s_' "$1" | sed "s/'/''/g")"
  printf "'%s'" "${escaped%_}"
}
SQL_SLUG="$(sql_literal "$SLUG")"

run_sql() {
  pnpm wrangler d1 execute "$DB_NAME" "${D1_TARGET[@]}" --command="$1"
}

# wrangler d1 execute はバナー等を stdout に混ぜるため、JSON 本体
# （'[' 始まり以降）を抽出して 1 行ずつ表示する。
print_rows() {
  sed -n '/^\[/,$p' | node -e '
    const out = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const rows = out[0]?.results ?? [];
    if (rows.length === 0) {
      console.error("（0 件。slug を確認してください）");
      process.exit(0);
    }
    for (const row of rows) console.log(JSON.stringify(row));
  '
}

run_sql "SELECT e.slug, e.title, datetime(e.starts_at, 'unixepoch') AS starts_at, datetime(e.ends_at, 'unixepoch') AS ends_at, (SELECT COUNT(*) FROM election_votes v WHERE v.election_slug = e.slug) AS total_votes FROM elections e WHERE e.slug = $SQL_SLUG;" | print_rows

run_sql "SELECT c.kind, c.annict_id, c.name, COUNT(v.id) AS votes FROM election_candidates c LEFT JOIN election_votes v ON v.candidate_id = c.id WHERE c.election_slug = $SQL_SLUG GROUP BY c.id ORDER BY votes DESC, c.position ASC;" | print_rows
