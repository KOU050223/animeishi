#!/usr/bin/env bash
# Annict 連携ファネル（issue #64 / docs/08_observability-design.md）の Sentry
# ダッシュボードを作成する。冪等ではないため、既存ダッシュボードがあれば
# 作り直す前に Sentry 上で削除すること。
#
# 前提: sentry CLI（https://cli.sentry.dev）で `sentry auth login` 済み。
# 使い方: bash scripts/sentry/setup-annict-funnel-dashboard.sh [org] [project]
set -euo pipefail

ORG="${1:-kou050223}"
PROJECT="${2:-animeishi-mobile}"
TITLE="Annict 連携ファネル"
BASE="message:annict_connect_funnel environment:production"

# 二重作成防止: 一覧取得に失敗したら作成に進まない（出力は変数に確保してから判定。
# パイプで grep -q すると pipefail 下の SIGPIPE で判定が偽になり得るため）。
# タイトルでサーバー側絞り込みし、キャッシュを避けて厳密一致で判定する。
if ! LIST="$(sentry dashboard list "$ORG" "$TITLE" --fresh --json)"; then
  echo "ダッシュボード一覧の取得に失敗しました。認証・権限を確認してください。" >&2
  exit 1
fi
# 判定結果: 0=同名あり / 1=同名なし / 2=一覧 JSON を解析できない（作成せず停止）
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
sys.exit(0 if any(isinstance(x, dict) and x.get("title") == title for x in items) else 1)
' "$TITLE" || FOUND=$?
case "$FOUND" in
  0)
    echo "ダッシュボード「$TITLE」は既に存在します。作り直す場合は Sentry 上で削除してから再実行してください。" >&2
    exit 1 ;;
  1) ;;
  *)
    echo "ダッシュボード一覧の応答を解析できませんでした。二重作成を避けるため中止します。" >&2
    exit 1 ;;
esac

sentry dashboard create "$ORG/$PROJECT" "$TITLE"
# ウィジェット追加の途中で失敗すると不完全なダッシュボードが残るため案内を出す。
trap 'echo "ウィジェット追加に失敗しました。Sentry 上で「$TITLE」を削除してから再実行してください。" >&2' ERR
D="$ORG/$PROJECT/$TITLE"
add() { sentry dashboard widget add "$D" "$@" --dataset logs; }

# KPI 3 枚（2+2+2）
add "誘導表示 (prompt_view)" --display big_number --query count --where "$BASE annict.step:prompt_view"
add "CTA タップ (cta_tap)"   --display big_number --query count --where "$BASE annict.step:cta_tap"
add "連携成功 (oauth success)" --display big_number --query count --where "$BASE annict.step:oauth_result annict.result:success"

# 推移と結果内訳（3+3）
add "ステップ別の推移" --display line --query count --where "$BASE" --group-by annict.step
add "OAuth 結果の内訳" --display bar --query count --where "$BASE annict.step:oauth_result" --group-by annict.result

# 導線（surface）別の表（6）
add "導線別 × ステップ" --display table --query count --where "$BASE" \
  --group-by annict.surface --group-by annict.step --sort -count --limit 50

# 失敗理由（6）
add "OAuth 失敗理由" --display table --query count \
  --where "$BASE annict.step:oauth_result annict.result:error" \
  --group-by annict.reason --group-by platform --sort -count --limit 20

echo "作成しました: $TITLE"
