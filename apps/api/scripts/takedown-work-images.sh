#!/usr/bin/env bash
# 作品画像の削除（MAL API 規約 3(e) の削除依頼対応。issue #241）
#
# MAL 公式 API から取り込んだ作品画像（annict_works.image_source='mal'）は、
# MAL から削除依頼が来たら 24 時間以内に消す必要がある。対象の作品ごとに
#   1. image_source を 'blocked' にし、resolved_image_url を NULL にする
#   2. R2（AVATARS バケットの works/ 配下）のオブジェクトを消し、image_r2_key を NULL にする
#   3. 画像プロキシ前段の Workers Cache を Purge Cache API で消す（issue #244）
# を行う。'blocked' の行は cron・画像プロキシ・検索のどの経路でも補完し直さない
# （Annict の元の image_url は MAL 由来ではないので、プロキシは引き続き配信してよい）。
#
# 使い方:
#   scripts/takedown-work-images.sh [--env production|preview | --local] [--yes] (--all-mal | <作品ID>...)
#
#   <作品ID>...   削除する作品の annict_work_id（空白区切りで複数可）
#   --all-mal     image_source='mal'/'blocked' の全作品を対象にする
#                 （'blocked' 済みの作品は、失敗した R2 削除・キャッシュ
#                 Purge のやり直しのため再度対象に含む）
#   --yes         確認プロンプトを出さずに実行する（ローカルの動作確認用）
#
# 環境変数（3. の Purge 用。未設定でも 1・2 は完了し、消せなかった URL を表示する）:
#   CLOUDFLARE_ZONE_ID          uomi.dev ゾーンの ID
#   CLOUDFLARE_PURGE_API_TOKEN  Zone.Cache Purge 権限を持つ API トークン
#
# 実行前に対象の件数と一覧を表示し、確認プロンプトを出す。
# --local と --env preview では Purge しない（preview の API は *.workers.dev で
# ゾーン Purge の対象外）。
set -euo pipefail

# wrangler.toml は apps/api にあるため、どこから呼んでもそこで実行する。
# help() が冒頭コメントを $0 から読むため、cd 前に絶対パスに解決しておく。
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT_PATH")/.."

help() {
  sed -n '2,25p' "$SCRIPT_PATH"
}

ENV="production"
LOCAL=0
ALL_MAL=0
ASSUME_YES=0
IDS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --local) LOCAL=1; shift ;;
    --env) ENV="${2:?--env には production|preview を指定}"; shift 2 ;;
    --env=*) ENV="${1#*=}"; shift ;;
    --all-mal) ALL_MAL=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h | --help) help; exit 0 ;;
    -*) echo "不明なオプション: $1" >&2; exit 1 ;;
    *)
      case "$1" in
        *[!0-9]*)
          echo "作品 ID は数値で指定してください: '$1'" >&2
          exit 1
          ;;
      esac
      IDS+=("$1")
      shift
      ;;
  esac
done

if [ "$ALL_MAL" = 1 ] && [ "${#IDS[@]}" -gt 0 ]; then
  echo "--all-mal と作品 ID は同時に指定できません" >&2
  exit 1
fi
if [ "$ALL_MAL" = 0 ] && [ "${#IDS[@]}" -eq 0 ]; then
  echo "作品 ID か --all-mal を指定してください" >&2
  help >&2
  exit 1
fi

DB_NAME="animeishi-db"
BUCKET="animeishi-avatars"
# -y: リモート実行時に wrangler が出す確認プロンプトを自動承認する。
# 削除の確認はこのスクリプト自身が件数を見せてから行う。
D1_TARGET=(--remote --env "$ENV" -y)
R2_TARGET=(--remote --env "$ENV")
if [ "$LOCAL" = 1 ]; then
  D1_TARGET=(--local)
  R2_TARGET=(--local)
elif [ "$ENV" = "preview" ]; then
  DB_NAME="animeishi-db-preview"
  BUCKET="animeishi-avatars-preview"
elif [ "$ENV" != "production" ]; then
  echo "不明な --env: ${ENV}（production|preview のみ）" >&2
  exit 1
fi
TARGET_LABEL="${DB_NAME} / ${BUCKET}"
[ "$LOCAL" = 1 ] && TARGET_LABEL="ローカル（${TARGET_LABEL}）"

SQL_TMPFILE="$(mktemp "${TMPDIR:-/tmp}/animeishi-takedown.XXXXXX")"
trap 'rm -f "$SQL_TMPFILE"' EXIT

# 作品 ID が数百件になっても --command の長さに縛られないよう、SQL は
# 一時ファイル経由（--file）で実行する。
run_sql_file() {
  printf '%s\n' "$1" >"$SQL_TMPFILE"
  pnpm exec wrangler d1 execute "$DB_NAME" "${D1_TARGET[@]}" --json --file="$SQL_TMPFILE"
}

# wrangler d1 execute --json の結果から行を取り出し、「id<TAB>key<TAB>source」で出力する。
# wrangler はバナー等を stdout に混ぜることがあるため、'[' 始まり以降を読む。
# 空の値は "-" にする（read の IFS にタブを使うと、連続するタブが 1 つに
# 潰れて列がずれるため）。
rows_as_tsv() {
  sed -n '/^\[/,$p' | node -e '
    const out = JSON.parse(require("fs").readFileSync(0, "utf8"));
    for (const r of out[0]?.results ?? []) {
      console.log([r.annict_work_id, r.image_r2_key ?? "-", r.image_source ?? "-"].join("\t"));
    }
  '
}

if [ "$ALL_MAL" = 1 ]; then
  # 'blocked'（削除済みの作品）も対象に含める。前回の実行で Purge や R2 削除
  # だけ失敗して残った分を、同じ --all-mal でやり直せるようにするため。
  WHERE="image_source IN ('mal', 'blocked')"
else
  WHERE="annict_work_id IN ($(IFS=,; echo "${IDS[*]}"))"
fi

echo "対象を取得中（${TARGET_LABEL}）..." >&2
TARGETS="$(run_sql_file "SELECT annict_work_id, image_r2_key, image_source, title FROM annict_works WHERE $WHERE ORDER BY annict_work_id;" | rows_as_tsv)"
TOTAL=$(printf '%s\n' "$TARGETS" | grep -c . || true)

if [ "$ALL_MAL" = 0 ]; then
  # 指定された ID のうち annict_works に無いものは知らせる（打ち間違いの検出）。
  for id in "${IDS[@]}"; do
    if ! printf '%s\n' "$TARGETS" | cut -f1 | grep -qx "$id"; then
      echo "警告: annict_works に作品 ID $id がありません（スキップ）" >&2
    fi
  done
fi

echo "対象: $TOTAL 件（${TARGET_LABEL}）"
[ "$TOTAL" -eq 0 ] && exit 0
printf '%s\n' "$TARGETS" | awk -F'\t' '{ printf "  id=%s source=%s r2=%s\n", $1, $3, $2 }'

if [ "$ASSUME_YES" = 0 ]; then
  printf '上記 %s 件の画像を削除し、以後の補完を止めます（元に戻せません）。続行しますか？ [y/N] ' "$TOTAL" >&2
  # 入力が閉じている（EOF）ときは中止側に倒す。
  read -r answer || answer=""
  case "$answer" in
    y | Y | yes | YES) ;;
    *) echo "中止しました" >&2; exit 1 ;;
  esac
fi

# 手順:
#   1. 行を 'blocked' にし、resolved_image_url を NULL にする（キーは残す）
#   2. 残ったキーを読み直し、R2 のオブジェクトを消す
#   3. 消せたキーだけを DB から外す
# 先に 'blocked' にすると、画像プロキシはそれ以降 MAL 由来のキーを配信も
# 記録もしなくなる（workImage.ts の storedServable / linkImageR2Key）。
# R2 を先に消すと、DB を更新するまでの間にプロキシが取り込み直し、
# 手元の一覧に無いキーが残りうる。キーは R2 から消せるまで DB に残すので、
# 途中で失敗・中断しても同じ作品 ID で再実行すれば消し直せる。
TARGET_IDS="$(printf '%s\n' "$TARGETS" | cut -f1 | paste -sd, -)"
echo "DB を更新中..." >&2
run_sql_file "UPDATE annict_works SET image_source = 'blocked', resolved_image_url = NULL WHERE annict_work_id IN ($TARGET_IDS);" >/dev/null
KEYS="$(run_sql_file "SELECT annict_work_id, image_r2_key, image_source FROM annict_works WHERE annict_work_id IN ($TARGET_IDS) AND image_r2_key IS NOT NULL ORDER BY annict_work_id;" | rows_as_tsv)"

# R2 のオブジェクトを消す。形式（works/<作品ID>/<hash>.<ext>）とその作品自身の
# キーであることを確かめ、avatars/ 等には触れない（workImage.ts の
# isOwnWorkImageKey と同じ条件）。キーは形式を確かめてあるので SQL に直接埋め込める。
FAILED_KEYS=()
DELETED=0
UNLINK_SQL=""
while IFS=$'\t' read -r id key _source; do
  [ -z "$id" ] && continue
  if ! [[ "$key" =~ ^works/${id}/[0-9a-f]+\.(jpe?g|png|webp|gif|JPE?G|PNG|WEBP|GIF)$ ]]; then
    # 形式外のキーはプロキシも配信しない（isOwnWorkImageKey）。中身を確かめて手で対応する。
    echo "警告: id=$id のキーが想定外の形式なので消しません: $key" >&2
    FAILED_KEYS+=("$id $key")
    continue
  fi
  ok=0
  for attempt in 1 2 3; do
    if pnpm exec wrangler r2 object delete "$BUCKET/$key" "${R2_TARGET[@]}" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep "$attempt"
  done
  if [ "$ok" = 1 ]; then
    DELETED=$((DELETED + 1))
    # 削除中にプロキシが Annict の画像で取り込み直した行は、新しいキーを外さない。
    UNLINK_SQL="${UNLINK_SQL}UPDATE annict_works SET image_r2_key = NULL WHERE annict_work_id = $id AND image_r2_key = '$key';"$'\n'
    printf '\r[R2] %d 件削除   ' "$DELETED" >&2
  else
    FAILED_KEYS+=("$id $key")
  fi
done <<<"$KEYS"
echo >&2
if [ -n "$UNLINK_SQL" ]; then
  run_sql_file "$UNLINK_SQL" >/dev/null
fi

# 3. プロキシ前段のキャッシュを Purge する（issue #244）。ローカル・preview は
# 対象外: ローカルはエッジキャッシュを持たず、preview の API は
# pr-<N>-animeishi-api-preview.*.workers.dev で、ゾーンの Purge API は
# そのゾーンに属するホスト名しか消せない。
# Purge できなくても D1/R2 の削除は完了しているので、失敗は表示するだけにし
# 巻き戻さない（最後に終了コードで知らせる）。
PURGE_FAILED=0
if [ "$LOCAL" = 1 ]; then
  echo "ローカル実行のためキャッシュ Purge はスキップ" >&2
elif [ "$ENV" = "preview" ]; then
  echo "preview の API は *.workers.dev でゾーン Purge の対象外のためスキップ" >&2
else
  # bash 3.2 には mapfile が無いので while-read で配列化する。
  PURGE_IDS=()
  while IFS= read -r id; do
    [ -n "$id" ] && PURGE_IDS+=("$id")
  done <<<"$(printf '%s\n' "$TARGETS" | cut -f1)"
  if ! node scripts/purge-image-cache.mjs "${PURGE_IDS[@]}"; then
    PURGE_FAILED=1
  fi
fi

echo "== 結果 =="
echo "  DB を 'blocked' にした作品: $TOTAL 件"
echo "  R2 から削除したオブジェクト: $DELETED 件"
EXIT_CODE=0
if [ "${#FAILED_KEYS[@]}" -gt 0 ]; then
  # 消せなかったキーは DB に残してある（プロキシは 'blocked' の行の MAL 画像を配信しない）。
  echo "== R2 から消せなかったキー（${#FAILED_KEYS[@]} 件）==" >&2
  FAILED_IDS=""
  for entry in "${FAILED_KEYS[@]}"; do
    echo "  id=${entry%% *} key=${entry#* }" >&2
    FAILED_IDS="$FAILED_IDS ${entry%% *}"
  done
  echo "削除の失敗は同じ作品 ID で再実行してください（形式外のキーは中身を確かめて手で消す）:${FAILED_IDS}" >&2
  EXIT_CODE=1
fi
if [ "$PURGE_FAILED" = 1 ]; then
  echo "キャッシュ Purge に失敗した URL があります。上の一覧をダッシュボードから手動で消すか、環境変数を直して再実行してください。" >&2
  EXIT_CODE=1
fi
exit "$EXIT_CODE"
