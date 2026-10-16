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

if sentry dashboard list "$ORG" --json 2>/dev/null | grep -q "\"title\": \"$TITLE\""; then
  echo "ダッシュボード「$TITLE」は既に存在します。作り直す場合は Sentry 上で削除してから再実行してください。" >&2
  exit 1
fi

sentry dashboard create "$ORG/$PROJECT/$TITLE"
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
