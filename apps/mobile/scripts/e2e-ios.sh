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
# 既定 "animeishi-e2e"）を simctl create で作って使う。
set -euo pipefail

cd "$(dirname "$0")/.."

SIM_NAME="${E2E_SIM_NAME:-animeishi-e2e}"
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

# --- Nix devShell 汚染の除去 -------------------------------------------------
# devShell 内から xcodebuild 等を叩くと toolchain 変数がネイティブビルドを壊すため、
# すべての子プロセスで unset し PATH 先頭を /usr/bin:/bin にする。
# node / pnpm / pod は PATH 後段から解決する。
NIX_SAFE_ENV=(
  env -u CC -u CXX -u LD -u AR -u NM -u RANLIB -u STRIP -u SDKROOT
  -u DEVELOPER_DIR -u NIX_CFLAGS_COMPILE -u NIX_LDFLAGS -u NIX_CFLAGS_LINK
  -u MACOSX_DEPLOYMENT_TARGET -u CPATH -u LIBRARY_PATH
  "PATH=/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.vite-plus/bin:$PATH"
)

# --- 専用シミュレーター -------------------------------------------------------
UDID="$("${NIX_SAFE_ENV[@]}" xcrun simctl list devices -j \
  | SIM_NAME="$SIM_NAME" /usr/bin/python3 -c 'import json,os,sys
name = os.environ["SIM_NAME"]
for devs in json.load(sys.stdin)["devices"].values():
    for dev in devs:
        if dev["name"] == name:
            print(dev["udid"])
            sys.exit()' | head -1)"
if [ -z "$UDID" ]; then
  RUNTIME_ID="$("${NIX_SAFE_ENV[@]}" xcrun simctl list runtimes -j \
    | /usr/bin/python3 -c 'import json,sys
rs = [r for r in json.load(sys.stdin)["runtimes"] if r.get("platform") == "iOS" and r.get("isAvailable", True)]
rs.sort(key=lambda r: [int(x) for x in r["version"].split(".")], reverse=True)
print(rs[0]["identifier"])')"
  DEVICE_TYPE="$("${NIX_SAFE_ENV[@]}" xcrun simctl list devicetypes -j \
    | /usr/bin/python3 -c 'import json,sys
ts = [t for t in json.load(sys.stdin)["devicetypes"] if t["identifier"].split(".")[-1].startswith("iPhone-1")]
ts.sort(key=lambda t: t["identifier"])
print(ts[-1]["identifier"])')"
  echo "E2E 用シミュレーターを作成: $SIM_NAME ($DEVICE_TYPE / $RUNTIME_ID)"
  UDID="$("${NIX_SAFE_ENV[@]}" xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME_ID")"
fi
echo "使用シミュレーター: $SIM_NAME ($UDID)"

# --- API (wrangler dev) ------------------------------------------------------
# アカウント削除は DELETE /me を呼ぶためローカル API が必須。
# 起動済みならそれを使い、無ければ起動して終了時に落とす。
api_up() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' "${EXPO_PUBLIC_API_URL}/" || true)" != "000" ]
}
API_PID=""
if api_up; then
  echo "API は起動済み ($EXPO_PUBLIC_API_URL)"
else
  echo "API を起動します (wrangler dev) ..."
  (cd ../../services/api && "${NIX_SAFE_ENV[@]}" pnpm dev >/tmp/animeishi-e2e-api.log 2>&1) &
  API_PID=$!
  trap '[ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do
    api_up && break
    sleep 1
  done
  api_up || { echo "API の起動に失敗しました。/tmp/animeishi-e2e-api.log を確認してください" >&2; exit 1; }
  # ローカル D1 にマイグレーションを適用（適用済みならスキップされる）
  (cd ../../services/api && "${NIX_SAFE_ENV[@]}" pnpm db:migrate:local >/dev/null)
fi

# --- ネイティブプロジェクト / ビルド -----------------------------------------
if [ ! -d ios/Animeishi.xcworkspace ]; then
  echo "ios/ がないため expo prebuild を実行します ..."
  "${NIX_SAFE_ENV[@]}" pnpm expo prebuild -p ios
fi

if [ "$SKIP_BUILD" != "1" ]; then
  echo "Release 相当ビルド中 (iphonesimulator) ..."
  "${NIX_SAFE_ENV[@]}" \
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
"${NIX_SAFE_ENV[@]}" xcrun simctl boot "$UDID" 2>/dev/null || true
"${NIX_SAFE_ENV[@]}" open -a Simulator --args -CurrentDeviceUDID "$UDID" 2>/dev/null || true
# 認証状態を確実にリセットするため再インストールする
"${NIX_SAFE_ENV[@]}" xcrun simctl uninstall "$UDID" "$APP_BUNDLE_ID" 2>/dev/null || true
"${NIX_SAFE_ENV[@]}" xcrun simctl install "$UDID" "$APP_PATH"

# --- Maestro -----------------------------------------------------------------
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
"${NIX_SAFE_ENV[@]}" maestro test --device "$UDID" .maestro
