#!/usr/bin/env bash
# 作品画像の一括補完（backfill）
#
# R2 に未取り込みの作品について、画像プロキシ GET /images/works/:id を
# 順に叩いて取り込みを走らせ、結果（200 / 404 等）を集計する。
# 取り込みのロジック自体はプロキシ（src/lib/annict/workImage.ts）にあり、
# このスクリプトは「全件を一度表示させる」だけ。新しい経路は増やさない。
#
# 使い方:
#   scripts/backfill-work-images.sh [--env production|preview] [--api-url URL]
#
# 環境変数:
#   BACKFILL_INTERVAL  1 件ごとの待ち秒数（既定 1）。プロキシは取り込みに
#                      失敗した作品で AniList を引くため、AniList のレート制限
#                      （公称 90 req/min・混雑時は 30 req/min）に触れない間隔にする。
#   BACKFILL_LIMIT     対象件数の上限（既定: 全件）。試し打ち用。
#
# 全候補が失敗した作品はプロキシ側で 6 時間のクールダウンに入るため、
# 直後に再実行しても外部は叩かれない（404 がすぐ返る）。
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT_PATH")/.."

ENV="production"
API_URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV="${2:?--env には production|preview を指定}"; shift 2 ;;
    --api-url) API_URL="${2:?--api-url には URL を指定}"; shift 2 ;;
    -h | --help) sed -n '2,20p' "$SCRIPT_PATH"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

case "$ENV" in
  production)
    DB_NAME="animeishi-db"
    API_URL="${API_URL:-https://animeishi-api.uomi.dev}"
    ;;
  preview)
    DB_NAME="animeishi-db-preview"
    if [ -z "$API_URL" ]; then
      echo "--env preview では --api-url を指定してください" >&2
      exit 1
    fi
    ;;
  *) echo "--env には production|preview を指定してください" >&2; exit 1 ;;
esac

INTERVAL="${BACKFILL_INTERVAL:-1}"
LIMIT_CLAUSE=""
if [ -n "${BACKFILL_LIMIT:-}" ]; then
  if ! [[ "$BACKFILL_LIMIT" =~ ^[0-9]+$ ]]; then
    echo "BACKFILL_LIMIT は整数で指定してください" >&2
    exit 1
  fi
  LIMIT_CLAUSE="LIMIT $BACKFILL_LIMIT"
fi

echo "対象を取得中（$DB_NAME / --env $ENV）..." >&2
IDS=$(
  pnpm exec wrangler d1 execute "$DB_NAME" --remote --env "$ENV" --json \
    --command "SELECT annict_work_id FROM annict_works WHERE image_r2_key IS NULL ORDER BY annict_work_id $LIMIT_CLAUSE" |
    node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d));
      process.stdin.on("end", () => {
        const rows = JSON.parse(s)[0]?.results ?? [];
        for (const r of rows) console.log(r.annict_work_id);
      });
    '
)

TOTAL=$(printf '%s\n' "$IDS" | grep -c . || true)
echo "対象: $TOTAL 件 → $API_URL/images/works/:id" >&2
[ "$TOTAL" -eq 0 ] && exit 0

# macOS 標準の bash 3.2 でも動くよう連想配列は使わず、結果を一時ファイルに
# 「status id」で書き出して最後に集計する。
RESULTS=$(mktemp)
trap 'rm -f "$RESULTS"' EXIT
i=0
while read -r id; do
  [ -z "$id" ] && continue
  i=$((i + 1))
  # 接続失敗・タイムアウト時も -w が "000" を出力するので、終了コードだけ握る。
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$API_URL/images/works/$id") || true
  echo "$status $id" >> "$RESULTS"
  printf '\r[%d/%d] id=%s → %s   ' "$i" "$TOTAL" "$id" "$status" >&2
  sleep "$INTERVAL"
done <<< "$IDS"
echo >&2

echo "== 結果（status: 件数）=="
cut -d' ' -f1 "$RESULTS" | sort | uniq -c | awk '{ printf "  %s: %s 件\n", $2, $1 }'
FAILED=$(awk '$1 != "200" { print $2 }' "$RESULTS" | head -50 | paste -sd ' ' -)
if [ -n "$FAILED" ]; then
  echo "== 200 以外の作品 ID（先頭 50 件）=="
  echo "$FAILED"
fi
