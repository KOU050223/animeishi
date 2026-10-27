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
LOCK_DIR="$STATE_DIR/lock"
LOCK_OWNER_FILE="$LOCK_DIR/owner"
API_PID_FILE="$STATE_DIR/api.pid"
mkdir -p "$STATE_DIR"

# ps -o lstart= の出力は前後に空白が付くので両端を削って返す。
# PID + 起動時刻の照合で、PID が再利用された無関係プロセスを見分ける。
lstart() {
  ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'
}

# ロック所有者がこのワークツリーで実行中の e2e-ios.sh なら真。
# 記録した PID と起動時刻が現在のプロセスと一致するときだけ有効とみなし、
# 前回実行が SIGKILL 等で残した残骸は偽（→ 取り直し）と判定する。
lock_owner_alive() {
  local pid started
  { read -r pid && read -r started; } <"$LOCK_OWNER_FILE" 2>/dev/null || return 1
  [ -n "$pid" ] && [ -n "$started" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -o command= -p "$pid" 2>/dev/null | grep -q e2e-ios.sh || return 1
  [ "$(lstart "$pid")" = "$started" ]
}

# 既存ロックの状態を live / acquiring / stale で返す。
# live: 実行中 / acquiring: mkdir 直後で所有者情報の公開前 / stale: 残骸。
# 所有者情報が無いロックは「取得中」か「書き込み前に殺された残骸」なので、
# できてからの経過時間（stat -f %B）で見分ける。
lock_state() {
  if [ -s "$LOCK_OWNER_FILE" ]; then
    lock_owner_alive && echo live || echo stale
  elif [ $(( $(date +%s) - $(stat -f %B "$LOCK_DIR" 2>/dev/null || echo 0) )) -lt 60 ]; then
    echo acquiring
  else
    echo stale
  fi
}

# mkdir で排他的にロックを取る。取れなければ所有者を調べ、死んでいれば
# 残骸として回収して取り直す。回収は reclaim ロックで直列化し、複数の
# 起動が同じ残骸ロックを同時に消し合って二重起動になるのを防ぐ。
while :; do
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    # 所有者情報を一時ファイル経由で一度に公開し、読み手が
    # 「書き込み途中の空ファイル」を残骸と誤認しないようにする
    printf '%s\n%s\n' "$$" "$(lstart $$)" >"$STATE_DIR/owner.$$"
    mv "$STATE_DIR/owner.$$" "$LOCK_OWNER_FILE"
    break
  fi
  case "$(lock_state)" in
    live)
      echo "このワークツリーで既に e2e:ios が実行中です (PID $(sed -n '1p' "$LOCK_OWNER_FILE"))。終わるまで待ってから再実行してください" >&2
      exit 1
      ;;
    acquiring)
      echo "このワークツリーで e2e:ios が起動処理中です。少し待ってから再実行してください" >&2
      exit 1
      ;;
  esac
  # stale → 残骸ロックの回収。reclaim も mkdir の排他ロックで、
  # 取れた者だけが lock を消して取り直せる
  if mkdir "$STATE_DIR/reclaim" 2>/dev/null; then
    if [ "$(lock_state)" != stale ]; then
      # 回収の隙間に別の実行がロックを取り直していた
      rm -rf "$STATE_DIR/reclaim"
      echo "このワークツリーで e2e:ios が実行中です。終わるまで待ってから再実行してください" >&2
      exit 1
    fi
    rm -rf "$LOCK_DIR" "$STATE_DIR/reclaim"
  elif [ $(( $(date +%s) - $(stat -f %B "$STATE_DIR/reclaim" 2>/dev/null || echo 0) )) -gt 120 ]; then
    rm -rf "$STATE_DIR/reclaim" # 回収処理自体が殺された残骸
  else
    echo "他の e2e:ios がロックの残骸を回収中です。少し待ってから再実行してください" >&2
    exit 1
  fi
done

# --- API 利用の共有レジストリ -------------------------------------------------
# EXPO_PUBLIC_API_URL のポートは全ワークツリー共通なので、起動済みの API を
# 別ワークツリーの E2E が再利用しうる。自分が起動した API を止める前に
# 「他の実行がまだ使っているか」をここで調べ、使用中なら止めない。
# 各実行は自分の PID + 起動時刻を登録し、終了時に削除する。
API_USERS_DIR="${TMPDIR:-/tmp}/animeishi-e2e-api-users"
API_USER_FILE="$API_USERS_DIR/$(printf '%s' "$PWD" | cksum | cut -d' ' -f1)"
mkdir -p "$API_USERS_DIR"
printf '%s\n%s\n' "$$" "$(lstart $$)" >"$API_USER_FILE"

# 自分以外に登録のあるワークツリーが生きているか。所有者が死んだ
# 残骸エントリはここで掃除する。
api_has_other_users() {
  local f pid started
  for f in "$API_USERS_DIR"/*; do
    [ -e "$f" ] || continue
    [ "$f" = "$API_USER_FILE" ] && continue
    { read -r pid && read -r started; } <"$f" 2>/dev/null || continue
    if [ -n "$pid" ] && [ -n "$started" ] && [ "$(lstart "$pid")" = "$started" ]; then
      return 0
    fi
    rm -f "$f"
  done
  return 1
}

# 起動した API（wrangler dev）のサブシェル PID。空なら既存 API を再利用中。
API_PID=""
cleanup() {
  rm -f "$API_USER_FILE"
  if [ -n "$API_PID" ]; then
    if api_has_other_users; then
      # 他ワークツリーの実行がまだこの API を使っている → 止めずに
      # 起動者の記録（api.pid）を残す。使い終わった後に動いた実行が回収する
      :
    else
      kill -- -"$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null
      wait "$API_PID" 2>/dev/null || true
      rm -f "$API_PID_FILE"
    fi
  fi
  rm -rf "$LOCK_DIR" "$STATE_DIR/owner.$$"
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
  [ "$(lstart "$pid")" = "$started" ]
}
if api_pid_running; then
  if api_up && api_has_other_users; then
    # 起動側が SIGKILL で落ちて残った API を別ワークツリーが再利用中。
    # 止めると向こうの実行が壊れるので、このまま使い、起動者の記録
    # （api.pid）は残しておく。使い終わった後に動いた実行が回収する。
    echo "前回起動した API を他ワークツリーの E2E が使用中のため、止めずに再利用します"
  else
    OLD_API_PID="$(sed -n '1p' "$API_PID_FILE")"
    echo "前回起動した API (PID $OLD_API_PID) が残っているため停止します ..."
    kill -- -"$OLD_API_PID" 2>/dev/null || kill "$OLD_API_PID" 2>/dev/null
    for _ in $(seq 1 10); do
      kill -0 "$OLD_API_PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$OLD_API_PID" 2>/dev/null; then
      # 消せなかった API を api.pid も消して見失わないよう、記録を残して終了
      echo "残骸 API (PID $OLD_API_PID) が停止しません。手動で止めてから再実行してください" >&2
      exit 1
    fi
    rm -f "$API_PID_FILE"
  fi
fi
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
  printf '%s\n%s\n' "$API_PID" "$(lstart "$API_PID")" >"$API_PID_FILE"
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
