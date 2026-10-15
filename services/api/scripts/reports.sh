#!/usr/bin/env bash
# 通報のモデレーション操作（issue #186）
#
# reports テーブルの棚卸し・対応ステータス更新を wrangler d1 execute 経由で
# 行う運営用スクリプト。認可設計が未決のため管理画面・管理者 API は作らず、
# このスクリプト（または task reports:*）を運営の操作手段とする。
#
# 使い方（先頭のグローバルオプションは全コマンド共通）:
#   scripts/reports.sh [--env production|preview | --local] <command>
#
#   list [--status open|resolved|dismissed|all] [--by-user]
#                          通報一覧。既定は未対応(open)のみ。
#                          --by-user は被通報ユーザーごとの件数集計。
#   resolve <id> [対応メモ]  対応済みにする（resolved_at に現在時刻）
#   dismiss <id> [対応メモ]  却下する（対応不要と判断した場合）
#   reopen <id>             未対応に戻す（resolved_at をクリア。
#                          resolution_note は過去の対応記録として残す）
#
# 既定の接続先は本番（--env production）。--local は wrangler dev が使う
# ローカル D1。状態更新系は更新後の行を表示し、対象 id が存在しない
# 場合はエラーで終了する。
set -euo pipefail

# wrangler.toml は services/api にあるため、どこから呼んでもそこで実行する。
cd "$(dirname "$0")/.."

help() {
  sed -n '2,21p' "$0"
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
D1_TARGET=(--remote --env "$ENV")
if [ "$LOCAL" = 1 ]; then
  D1_TARGET=(--local)
elif [ "$ENV" = "preview" ]; then
  DB_NAME="animeishi-db-preview"
elif [ "$ENV" != "production" ]; then
  echo "不明な --env: ${ENV}（production|preview のみ）" >&2
  exit 1
fi

# ユーザー入力を含む SQL は --command の文字列連結では組まず、一時ファイル経由
# （--file）で実行する。対応メモ中の引用符・$・バッククォート等でシェル解釈を
# 壊さないため。SQL 側は ' を '' に潰すだけで安全に埋め込める。
# 一時ファイルは起動時に1つだけ作る（コマンド置換のサブシェルから呼ばれても
# 親側の EXIT trap で確実に消せるように）。
SQL_TMPFILE="$(mktemp "${TMPDIR:-/tmp}/animeishi-reports.XXXXXX")"
trap 'rm -f "$SQL_TMPFILE"' EXIT

run_sql_file() {
  printf '%s\n' "$1" >"$SQL_TMPFILE"
  pnpm wrangler d1 execute "$DB_NAME" "${D1_TARGET[@]}" --file="$SQL_TMPFILE"
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
  # 単一引用符を二重化した SQL 文字列リテラルを返す
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

require_numeric_id() {
  case "${1:-}" in
    '' | *[!0-9]*)
      echo "通報 id は数値で指定してください（list で確認できます）: '${1:-}'" >&2
      exit 1
      ;;
  esac
}

# UPDATE ... RETURNING の実行結果を受け取り、対象行が実際に更新されたかを
# 確認して表示する。wrangler はバナー等を stdout に混ぜるため、JSON 本体
# （'[' 始まり以降）を抽出して node でパースする。
run_update() {
  local output
  if ! output="$(run_sql_file "$1")"; then
    echo "d1 execute に失敗しました" >&2
    exit 1
  fi
  printf '%s\n' "$output" | sed -n '/^\[/,$p' | node -e '
    const out = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const rows = out[0]?.results ?? [];
    if (rows.length === 0) {
      console.error("対象の通報が見つかりませんでした（id を確認してください）");
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
    STATUS="open"
    BY_USER=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --status) STATUS="${2:?--status には open|resolved|dismissed|all を指定}"; shift 2 ;;
        --status=*) STATUS="${1#*=}"; shift ;;
        --by-user) BY_USER=1; shift ;;
        *) echo "不明な引数: $1" >&2; exit 1 ;;
      esac
    done
    case "$STATUS" in
      open | resolved | dismissed) WHERE="r.status = '$STATUS'" ;;
      all) WHERE="1 = 1" ;;
      *) echo "不明な --status: ${STATUS}（open|resolved|dismissed|all）" >&2; exit 1 ;;
    esac

    if [ "$BY_USER" = 1 ]; then
      # 被通報ユーザーごとの集計。累積通報の多いユーザーを上から見る。
      run_sql_file "SELECT r.reported_user_id, u.username, COUNT(*) AS report_count, MAX(datetime(r.created_at, 'unixepoch')) AS latest_reported_at FROM reports r LEFT JOIN users u ON u.id = r.reported_user_id WHERE $WHERE GROUP BY r.reported_user_id ORDER BY report_count DESC, latest_reported_at DESC;" | print_rows
    else
      run_sql_file "SELECT r.id, r.status, tu.username AS reported_user, r.reported_user_id, ru.username AS reporter, r.reporter_id, r.reason, datetime(r.created_at, 'unixepoch') AS reported_at, datetime(r.resolved_at, 'unixepoch') AS resolved_at, r.resolution_note FROM reports r LEFT JOIN users ru ON ru.id = r.reporter_id LEFT JOIN users tu ON tu.id = r.reported_user_id WHERE $WHERE ORDER BY r.created_at ASC;" | print_rows
    fi
    ;;

  resolve | dismiss)
    ID="${1:-}"
    require_numeric_id "$ID"
    shift
    # 引数の残り全部を対応メモとして連結する（クオート不要で書けるように）。
    NOTE="$*"
    if [ -n "$NOTE" ]; then
      NOTE_SQL="$(sql_literal "$NOTE")"
    else
      NOTE_SQL="NULL"
    fi
    if [ "$cmd" = "resolve" ]; then NEW_STATUS="resolved"; else NEW_STATUS="dismissed"; fi
    run_update "UPDATE reports SET status = '$NEW_STATUS', resolved_at = unixepoch(), resolution_note = $NOTE_SQL WHERE id = $ID RETURNING id, status, reported_user_id, resolution_note, datetime(resolved_at, 'unixepoch') AS resolved_at;"
    ;;

  reopen)
    ID="${1:-}"
    require_numeric_id "$ID"
    run_update "UPDATE reports SET status = 'open', resolved_at = NULL WHERE id = $ID RETURNING id, status, reported_user_id, resolution_note;"
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
