#!/usr/bin/env bash
# UI イベント計測（issue #214 / docs/08_observability-design.md「UI イベント
# 計測」節）の Sentry ダッシュボードを作成する。冪等: ダッシュボードが無ければ
# 作成し、既にあるタイトルのウィジェットは追加せずスキップする
# （途中失敗後の再実行可）。
#
# 前提: sentry CLI（https://cli.sentry.dev）で `sentry auth login` 済み
#       （ダッシュボード作成・編集権限が必要）。
# 使い方: bash scripts/sentry/setup-ui-events-dashboard.sh [org] [project]
set -euo pipefail

ORG="${1:-kou050223}"
PROJECT="${2:-animeishi-mobile}"
TITLE="UI イベント計測"
# 汎用 UI イベントは event.name 属性を持つ（message でも同じ値が入るが、
# has:event.name に絞ると annict_connect_funnel 等の他用途ログが混ざらない）。
BASE="environment:production has:event.name"

# 一覧取得に失敗したら何もしない（出力は変数に確保してから判定。パイプで
# grep -q すると pipefail 下の SIGPIPE で判定が偽になり得るため）。
if ! LIST="$(sentry dashboard list "${ORG}" "${TITLE}" --fresh --json)"; then
  echo "ダッシュボード一覧の取得に失敗しました。認証・権限を確認してください。" >&2
  exit 1
fi
# 0=同名あり / 1=同名なし / 2=一覧 JSON を解析できない（何もせず停止）
FOUND=0
printf '%s' "$LIST" | python3 -c '
import json, sys
title = sys.argv[1]
try:
    d = json.load(sys.stdin)
    items = d["data"] if isinstance(d, dict) else d
    if not isinstance(items, list):
        raise ValueError("unexpected shape")
except Exception:
    sys.exit(2)
matches = [x for x in items if isinstance(x, dict) and x.get("title") == title]
if len(matches) > 1:
    sys.exit(3)  # 同名が複数あるとタイトル解決が曖昧になるため止める
sys.exit(0 if matches else 1)
' "${TITLE}" || FOUND=$?
case "$FOUND" in
  0) echo "ダッシュボード「${TITLE}」は既に存在します。不足しているウィジェットだけ追加します。" ;;
  1) sentry dashboard create "${ORG}/${PROJECT}" "${TITLE}" ;;
  3)
    echo "ダッシュボード「${TITLE}」が複数あります。Sentry 上で 1 つにしてから再実行してください。" >&2
    exit 1 ;;
  *)
    echo "ダッシュボード一覧の応答を解析できませんでした。二重作成を避けるため中止します。" >&2
    exit 1 ;;
esac

# 既存ウィジェットのタイトル一覧（改行区切り）。取得に失敗したら停止する
# （判定できないまま追加すると重複するため）。
if ! VIEW="$(sentry dashboard view "${ORG}" "${TITLE}" --fresh --json)"; then
  echo "ダッシュボードの取得に失敗しました。" >&2
  exit 1
fi
# 解析できない場合は止める（全ウィジェットを重複追加しないため）。
if ! EXISTING="$(printf '%s' "$VIEW" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    widgets = d["widgets"]
    if not isinstance(widgets, list):
        raise ValueError("unexpected shape")
except Exception:
    sys.exit(2)
print("\n".join(w.get("title", "") for w in widgets if isinstance(w, dict)))
')"; then
  echo "ダッシュボードの応答を解析できませんでした。重複追加を避けるため中止します。" >&2
  exit 1
fi

# widget add の位置引数は [<org/project>] <dashboard> <widget title> の順。
add() {
  local wtitle="$1"; shift
  # パイプ（printf | grep -q）だと grep の早期終了で printf が SIGPIPE になり、
  # pipefail 下で一致を取りこぼして重複追加し得るため here-string で渡す。
  if grep -Fxq -- "${wtitle}" <<<"${EXISTING}"; then
    echo "skip: ${wtitle}（既存）"
    return 0
  fi
  sentry dashboard widget add "${ORG}/${PROJECT}" "${TITLE}" "${wtitle}" "$@" --dataset logs
}

# KPI（総数）
add "イベント総数" --display big_number --query count --where "${BASE}"

# 日別推移（イベント別 / 画面別）
add "日別推移（イベント別）" --display line --query count --where "${BASE}" --group-by event.name
add "日別推移（画面別）" --display line --query count --where "${BASE}" --group-by screen

# ボタン別回数・画面別内訳
add "ボタン別回数" --display table --query count --where "${BASE}" \
  --group-by event.name --sort=-count --limit 50
add "画面別 × イベント" --display table --query count --where "${BASE}" \
  --group-by screen --group-by event.name --sort=-count --limit 50

# イベント別の内訳
add "Tier 表の共有方式" --display table --query count \
  --where "${BASE} event.name:tier_share" --group-by method --sort=-count
add "視聴ステータスの遷移" --display table --query count \
  --where "${BASE} event.name:watch_status_change" \
  --group-by from --group-by to --sort=-count --limit 20
add "お気に入り操作" --display table --query count \
  --where "${BASE} event.name:favorite_toggle" --group-by action
add "AI 分析の種別" --display table --query count \
  --where "${BASE} event.name:analysis_generate" --group-by run_type

echo "完了: ${TITLE}"
