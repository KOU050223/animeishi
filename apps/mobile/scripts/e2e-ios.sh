#!/usr/bin/env bash
# iOS シミュレーターで Maestro E2E を実行する（issue #42）。
#   専用シミュレーター作成 → Release 相当ビルド → インストール → maestro test
#
# 前提:
#   - maestro CLI（brew install mobile-dev-inc/tap/maestro）
#   - Xcode + iOS シミュレーターランタイム
#   - pnpm install 済み（ios/ が無ければ expo prebuild を実行する）
#   - EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY に pk_test（開発インスタンス）。
#     未設定なら apps/mobile/.env から読む。pk_live は誤爆防止で拒否する。
#   - EXPO_PUBLIC_API_URL（既定: http://localhost:8787）
#
# 他ワーカーと衝突しないよう、E2E 専用シミュレーター（E2E_SIM_NAME、
# 既定 "animeishi-e2e-<ワークツリー名>"）を simctl create で作って使う。
# 同じワークツリーでの多重起動は .e2e-ios/lock で弾く（issue #275）。
set -euo pipefail

cd "$(dirname "$0")/.."

# --- 多重起動の排除（issue #275）--------------------------------------------
# 実行状態（ロック・起動した API の PID）を置く gitignore 済みディレクトリ。
# 同じワークツリーで二重起動すると ios/build/e2e-dd のビルド DB を取り合って
# xcodebuild が "database is locked" で失敗するため、ロックで弾く。
STATE_DIR="$PWD/.e2e-ios"
LOCK_FILE="$STATE_DIR/lock"
API_PID_FILE="$STATE_DIR/api.pid"
mkdir -p "$STATE_DIR"

# set -o noclobber + リダイレクトで「作成と PID 書き込み」を1操作で行う。
if ! (set -o noclobber; echo $$ >"$LOCK_FILE") 2>/dev/null; then
  LOCK_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null \
    && ps -o command= -p "$LOCK_PID" 2>/dev/null | grep -q e2e-ios.sh; then
    echo "このワークツリーで既に e2e:ios が実行中です (PID $LOCK_PID)。終わるまで待ってから再実行してください" >&2
    exit 1
  fi
  # 前回実行が SIGKILL 等で落ちた残骸 → 除去して取り直す
  rm -f "$LOCK_FILE"
  if ! (set -o noclobber; echo $$ >"$LOCK_FILE") 2>/dev/null; then
    echo "このワークツリーで既に e2e:ios が実行中です。終わるまで待ってから再実行してください" >&2
    exit 1
  fi
fi

# 起動した API（wrangler dev）のサブシェル PID。空なら既存 API を再利用中。
API_PID=""
cleanup() {
  if [ -n "$API_PID" ]; then
    kill -- -"$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null || true
  fi
  rm -f "$API_PID_FILE" "$LOCK_FILE"
}
trap cleanup EXIT

# ワークツリー単位で一意にして、同一ホスト上の並列実行同士が
# 同じシミュレーターを共有しないようにする。
WORKTREE_NAME="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
SIM_NAME="${E2E_SIM_NAME:-animeishi-e2e-$WORKTREE_NAME}"
APP_BUNDLE_ID="com.animeishi.app"
DERIVED_DATA="ios/build/e2e-dd"
SKIP_BUILD="${E2E_SKIP_BUILD:-0}"

# --- Clerk / API の設定 -----------------------------------------------------
# 環境変数が未設定なら .env（gitignore 済み）を読む。
if [ -z "${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ] && [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:?EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY を設定してください（pk_test の開発インスタンス。GitHub Variable EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY_PREVIEW と同じ値）}"
case "$EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" in
  pk_test_*) ;;
  *)
    echo "E2E は Clerk 開発インスタンス (pk_test) 専用です。pk_live は使えません" >&2
    exit 1
    ;;
esac
EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-http://localhost:8787}"

# --- 専用シミュレーター -------------------------------------------------------
UDID="$(xcrun simctl list devices -j \
  | SIM_NAME="$SIM_NAME" /usr/bin/python3 -c 'import json,os,sys
name = os.environ["SIM_NAME"]
for devs in json.load(sys.stdin)["devices"].values():
    for dev in devs:
        if dev["name"] == name and dev.get("isAvailable", True):
            print(dev["udid"])
            sys.exit()' | head -1)"
if [ -z "$UDID" ]; then
  RUNTIME_ID="$(xcrun simctl list runtimes -j \
    | /usr/bin/python3 -c 'import json,sys
rs = [r for r in json.load(sys.stdin)["runtimes"] if r.get("platform") == "iOS" and r.get("isAvailable", True)]
rs.sort(key=lambda r: [int(x) for x in r["version"].split(".")], reverse=True)
print(rs[0]["identifier"])')"
  DEVICE_TYPE="$(xcrun simctl list devicetypes -j \
    | /usr/bin/python3 -c 'import json,sys
ts = [t for t in json.load(sys.stdin)["devicetypes"] if t["identifier"].split(".")[-1].startswith("iPhone-1")]
ts.sort(key=lambda t: t["identifier"])
print(ts[-1]["identifier"])')"
  echo "E2E 用シミュレーターを作成: $SIM_NAME ($DEVICE_TYPE / $RUNTIME_ID)"
  UDID="$(xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME_ID")"
fi
echo "使用シミュレーター: $SIM_NAME ($UDID)"

# --- API (wrangler dev) ------------------------------------------------------
# アカウント削除は DELETE /me を呼ぶためローカル API が必須。
# 起動済みならそれを使い、無ければ起動して終了時に落とす。
# /health の "status":"ok" を確認して、同ポートを占有する別サービスを
# API と誤認しないようにする。
api_up() {
  curl -fsS "${EXPO_PUBLIC_API_URL}/health" 2>/dev/null | grep -q '"status":"ok"'
}
# API_PID_FILE に記録した API がまだ生きているか。スクリプトが SIGKILL で
# 落ちると EXIT trap が動かず wrangler dev が残るため、次回起動時に
# ここで回収する。PID の再利用で無関係なプロセスを止めないよう、
# 起動時刻 (lstart) が記録と一致したときだけ「自分が起動した」と判定する。
api_pid_running() {
  [ -f "$API_PID_FILE" ] || return 1
  local pid started
  { read -r pid && read -r started; } <"$API_PID_FILE" 2>/dev/null || return 1
  [ -n "$pid" ] && [ -n "$started" ] || return 1
  [ "$(ps -o lstart= -p "$pid" 2>/dev/null | sed 's/^ *//; s/ *$//')" = "$started" ]
}
if api_pid_running; then
  OLD_API_PID="$(sed -n '1p' "$API_PID_FILE")"
  echo "前回起動した API (PID $OLD_API_PID) が残っているため停止します ..."
  kill -- -"$OLD_API_PID" 2>/dev/null || kill "$OLD_API_PID" 2>/dev/null
  for _ in $(seq 1 10); do
    kill -0 "$OLD_API_PID" 2>/dev/null || break
    sleep 1
  done
fi
rm -f "$API_PID_FILE"
# 指定 URL のポートを wrangler dev に引き継ぐ（既定 8787 以外も可）。
API_PORT=""
case "$EXPO_PUBLIC_API_URL" in
  http://*:* | https://*:*)
    API_PORT="${EXPO_PUBLIC_API_URL##*:}"
    API_PORT="${API_PORT%%/*}"
    ;;
esac
if api_up; then
  echo "API は起動済み ($EXPO_PUBLIC_API_URL)"
else
  echo "API を起動します (wrangler dev) ..."
  API_LOG="$(mktemp -t animeishi-e2e-api.XXXXXX)"
  # バックグラウンドジョブに独自プロセスグループを与え、pnpm → wrangler →
  # workerd の子プロセスごと終了できるようにする。
  set -m
  DEV_ARGS=()
  [ -n "$API_PORT" ] && DEV_ARGS+=(--port "$API_PORT")
  (cd ../../apps/api && pnpm dev ${DEV_ARGS[@]+"${DEV_ARGS[@]}"} >"$API_LOG" 2>&1) &
  API_PID=$!
  set +m
  # SIGKILL 等でこのスクリプトが落ちても次回起動時に回収できるよう、
  # PID と起動時刻を記録しておく。
  {
    echo "$API_PID"
    ps -o lstart= -p "$API_PID" | sed 's/^ *//; s/ *$//'
  } >"$API_PID_FILE"
  for _ in $(seq 1 60); do
    api_up && break
    sleep 1
  done
  api_up || { echo "API の起動に失敗しました。$API_LOG を確認してください" >&2; exit 1; }
  # ローカル D1 にマイグレーションを適用（適用済みならスキップされる）
  (cd ../../apps/api && pnpm db:migrate:local >/dev/null)
fi

# --- ネイティブプロジェクト / ビルド -----------------------------------------
if [ ! -d ios/Animeishi.xcworkspace ]; then
  echo "ios/Animeishi.xcworkspace がないため expo prebuild を実行します ..."
  pnpm expo prebuild -p ios
  # ios/ が残っていると prebuild が CocoaPods をスキップし、xcworkspace が
  # 作られないまま xcodebuild が失敗するため明示的に pod install する（issue #275）
  if [ ! -d ios/Animeishi.xcworkspace ]; then
    echo "xcworkspace がまだないため pod install を実行します ..."
    (cd ios && pod install)
  fi
fi

if [ "$SKIP_BUILD" != "1" ]; then
  echo "Release 相当ビルド中 (iphonesimulator) ..."
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="$EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" \
    EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" \
    SENTRY_DISABLE_AUTO_UPLOAD=true \
    xcodebuild \
      -workspace ios/Animeishi.xcworkspace \
      -scheme Animeishi \
      -configuration Release \
      -sdk iphonesimulator \
      -destination "id=$UDID" \
      -derivedDataPath "$DERIVED_DATA" \
      CODE_SIGN_IDENTITY="-" \
      ONLY_ACTIVE_ARCH=YES
fi

APP_PATH="$DERIVED_DATA/Build/Products/Release-iphonesimulator/Animeishi.app"
[ -d "$APP_PATH" ] || { echo "アプリが見つかりません: $APP_PATH" >&2; exit 1; }

# --- インストール ------------------------------------------------------------
xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator --args -CurrentDeviceUDID "$UDID" 2>/dev/null || true
# 認証状態を確実にリセットするため再インストールする
xcrun simctl uninstall "$UDID" "$APP_BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP_PATH"

# --- Maestro -----------------------------------------------------------------
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
maestro test --device "$UDID" .maestro
