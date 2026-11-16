#!/usr/bin/env bash
# D1 マイグレーションの書き換え・番号の重複を検出する（issue #515）。
#
# 使い方: bash apps/api/scripts/check-migrations.sh <比較元の ref>
#
# wrangler は d1_migrations にファイル名で適用記録を残し、中身は見ない。そのため
#   - 適用済みのファイルを書き換えても、書き換えた分は二度と当たらない
#   - ファイル名を変えると、別のマイグレーションとして当て直そうとして失敗する
# 比較元の ref の時点で存在した .sql の変更・削除・改名と、番号の重複をエラーにする。
set -euo pipefail

base="${1:?比較元の ref を指定してください}"
dir="apps/api/migrations"
status=0

changed="$(git diff --name-status --diff-filter=DMR "$base" HEAD -- "$dir/*.sql")"
if [[ -n "$changed" ]]; then
  echo "::error::比較元（${base}）の時点で存在したマイグレーションが変更・削除・改名されています。"
  echo "$changed"
  echo "適用済みの D1 にはこの変更が当たりません。変更は新しい番号のファイルとして追加してください。"
  echo "preview D1 にすでに古い内容が当たっている場合の直し方: docs/runbook/production-tasks.md の「preview D1 のずれを直す」"
  status=1
fi

dups="$(git ls-files "$dir/*.sql" | xargs -n1 basename | cut -d_ -f1 | sort | uniq -d)"
if [[ -n "$dups" ]]; then
  echo "::error::マイグレーションの番号が重複しています: $(echo "$dups" | tr '\n' ' ')"
  echo "main に後から入った側を、main の最新番号の次に振り直してください。"
  status=1
fi

exit "$status"
