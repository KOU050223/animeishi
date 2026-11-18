#!/usr/bin/env bash
# 公開一覧からのユーザー除外（issue #580）
#
# users.public_list_exclusion の確認・設定・解除を wrangler d1 execute
# 経由で行う運営用スクリプト。値は除外の理由（demo / banned 等の任意文字列）、
# NULL は一覧に出す。
#
# 使い方（先頭のグローバルオプションは全コマンド共通）:
#   scripts/public-list-exclusion.sh [--env production|preview | --local] <command>
#
#   list                       除外中のユーザー一覧（id・username・理由）
#   exclude <id> <理由>         公開一覧から除外する。id・理由は EXCLUDE_USER_ID /
#                              EXCLUDE_REASON 環境変数でも渡せる
#                              （Taskfile 経由の指定方法）
#   unexclude <id>             除外を解除する（NULL に戻す）
#
# 既定の接続先は本番（--env production）。--local は wrangler dev が使う
# ローカル D1。更新系は更新後の行を表示し、対象 id が存在しない場合は
# エラーで終了する。
set -euo pipefail

# wrangler.toml は apps/api にあるため、どこから呼んでもそこで実行する。
# help() が冒頭コメントを $0 から読むため、cd 前に絶対パスに解決しておく
# （reports.sh と同じ理由）。
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT_PATH")/.."

help() {
  sed -n '2,22p' "$SCRIPT_PATH"
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
# -y: リモート実行時に wrangler が出す確認プロンプトを自動承認する。
# 本番更新の確認は Taskfile 側の prompt:（task users:exclude 等）が担う設計。
D1_TARGET=(--remote --env "$ENV" -y)
if [ "$LOCAL" = 1 ]; then
  D1_TARGET=(--local)
elif [ "$ENV" = "preview" ]; then
  DB_NAME="animeishi-db-preview"
elif [ "$ENV" != "production" ]; then
  echo "不明な --env: ${ENV}（production|preview のみ）" >&2
  exit 1
fi

# --remote --file はインポート API 経由で SELECT の結果行が返らないため、
# 読み書きとも結果が返る --command に統一する（wrangler 4.83.0）。
run_query() {
  pnpm wrangler d1 execute "$DB_NAME" "${D1_TARGET[@]}" --command "$1" --json
}

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

sql_literal() {
  # 単一引用符を二重化した SQL 文字列リテラルを返す。
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

require_user_id() {
  case "${1:-}" in
    '')
      echo "ユーザー id を指定してください（list で確認できます）" >&2
      exit 1
      ;;
  esac
}

# UPDATE 実行後に対象行を SELECT で確かめる（--command の結果行で検証する
# ため --file にはしない）。対象が無い・フラグが反映されていなければエラー。
run_update() {
  local output
  if ! output="$(run_query "$1")"; then
    printf '%s\n' "$output" >&2
    echo "d1 execute に失敗しました" >&2
    exit 1
  fi
  printf '%s\n' "$output" | sed -n '/^\[/,$p' | node -e '
    const out = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (!out[0]?.success) {
      console.error("UPDATE が失敗しました");
      process.exit(1);
    }
  '
  if ! output="$(run_query "$2")"; then
    printf '%s\n' "$output" >&2
    echo "更新後の確認 SELECT に失敗しました" >&2
    exit 1
  fi
  printf '%s\n' "$output" | sed -n '/^\[/,$p' | node -e '
    const out = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const rows = out[0]?.results ?? [];
    if (rows.length === 0) {
      console.error("対象のユーザーが見つかりませんでした（id を確認してください）");
      process.exit(1);
    }
    console.log("更新しました:");
    console.log(JSON.stringify(rows[0], null, 2));
  '
}

cmd="${1:-}"
if [ $# -gt 0 ]; then shift; fi

case "$cmd" in
  list)
    run_query "SELECT id, username, public_list_exclusion FROM users WHERE public_list_exclusion IS NOT NULL ORDER BY id;" | print_rows
    ;;

  exclude)
    ID="${1:-${EXCLUDE_USER_ID:-}}"
    require_user_id "$ID"
    REASON="${2:-${EXCLUDE_REASON:-}}"
    if [ -z "$REASON" ]; then
      echo "除外理由を指定してください（demo / banned 等）" >&2
      exit 1
    fi
    run_update \
      "UPDATE users SET public_list_exclusion = $(sql_literal "$REASON") WHERE id = $(sql_literal "$ID");" \
      "SELECT id, username, public_list_exclusion FROM users WHERE id = $(sql_literal "$ID");"
    ;;

  unexclude)
    ID="${1:-${EXCLUDE_USER_ID:-}}"
    require_user_id "$ID"
    run_update \
      "UPDATE users SET public_list_exclusion = NULL WHERE id = $(sql_literal "$ID");" \
      "SELECT id, username, public_list_exclusion FROM users WHERE id = $(sql_literal "$ID");"
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
