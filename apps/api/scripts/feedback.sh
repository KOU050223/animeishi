#!/usr/bin/env bash
# アプリ内の不具合報告・ご意見（feedbacks テーブル）を読む運営用スクリプト
#
# 使い方:
#   scripts/feedback.sh [--env production|preview | --local] list [--limit N]
#
#   list [--limit N]   新しい順に N 件表示する（既定 50）。
#                      category: bug（不具合）/ request（要望・ご意見）/ other（その他）
#
# 既定の接続先は本番（--env production）。--local は wrangler dev が使うローカル D1。
# Discord には件数しか通知しないため、内容はこのスクリプトで確認する。
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT_PATH")/.."

help() {
  sed -n '2,11p' "$SCRIPT_PATH"
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

# wrangler d1 execute はバナー等を stdout に混ぜるため、JSON 本体
# （'[' 始まり以降）を抽出して各行を 1 行 JSON で表示する。
print_rows() {
  sed -n '/^\[/,$p' | node -e '
    const out = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const rows = out[0]?.results ?? [];
    if (rows.length === 0) {
      console.error("（0 件）");
      process.exit(0);
    }
    for (const row of rows) console.log(JSON.stringify(row));
  '
}

cmd="${1:-}"
if [ $# -gt 0 ]; then shift; fi

case "$cmd" in
  list)
    LIMIT=50
    while [ $# -gt 0 ]; do
      case "$1" in
        --limit) LIMIT="${2:?--limit には件数を指定}"; shift 2 ;;
        --limit=*) LIMIT="${1#*=}"; shift ;;
        *) echo "不明な引数: $1" >&2; exit 1 ;;
      esac
    done
    case "$LIMIT" in
      '' | *[!0-9]*) echo "--limit は数値で指定してください: '$LIMIT'" >&2; exit 1 ;;
    esac
    pnpm wrangler d1 execute "$DB_NAME" "${D1_TARGET[@]}" --command \
      "SELECT f.id, datetime(f.created_at, 'unixepoch') AS created_at, f.category, u.username, f.user_id, f.app_version, f.platform, f.body FROM feedbacks f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC, f.id DESC LIMIT $LIMIT;" \
      | print_rows
    ;;

  "" | -h | --help | help)
    help
    ;;

  *)
    echo "不明なコマンド: $cmd" >&2
    help >&2
    exit 1
    ;;
esac
