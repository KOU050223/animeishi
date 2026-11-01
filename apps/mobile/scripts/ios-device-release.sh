#!/usr/bin/env bash
# 実機に Release 構成の dev client を入れる（Metro / wrangler dev 不要）。
# Debug ビルドは JS バンドルを Metro から読むため Mac が必須だが、Release は
# bundle をアプリに埋め込む（export:embed）ため Mac を閉じても動く。
# 埋め込む JS に焼き込む EXPO_PUBLIC_* は .env の開発用ではなく eas.json の
# build.production.env（本番 API・Clerk live・Annict 本番アプリ）を渡し、
# 更新チャネルも build.production.channel と同じものを埋め込んで
# EAS の production ビルドと同じく OTA を受信できるようにする。
# eas.json を変えればこのコマンドも自動で追従する。
#
#   pnpm ios:device:release                       # 接続中の実機に Release ビルド
#   pnpm ios:device:release --device <名前/UDID>  # 端末を指定
set -euo pipefail
cd "$(dirname "$0")/.."

# プロセス置換（< <(node ...)）だと node の失敗が set -e に拾われず、
# EXPO_PUBLIC_* 未設定のまま .env の開発用値でビルドが進んでしまうため、
# いったん変数に取って終了ステータスを検査する。
assignments="$(node -e '
  const build = JSON.parse(require("fs").readFileSync("eas.json", "utf8")).build.production;
  if (!build?.env) throw new Error("eas.json に build.production.env がありません");
  if (!build.env.EXPO_PUBLIC_API_URL) {
    throw new Error("build.production.env に EXPO_PUBLIC_API_URL がありません");
  }
  for (const [k, v] of Object.entries(build.env)) console.log(`${k}=${v}`);
  if (build.channel) console.log(`EXPO_UPDATES_CHANNEL=${build.channel}`);
')"
while IFS= read -r assignment; do
  export "$assignment"
done <<< "$assignments"

# Sentry のソースマップ/シンボル自動アップロードは SENTRY_AUTH_TOKEN を要求し、
# 無いと sentry-cli がエラー終了してビルドごと落ちる。実機確認用のローカル
# ビルドでは不要なので、トークン未設定なら無効化する。
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi

# run:ios は ios/ が既にあると prebuild をスキップするため、更新チャネルを
# Expo.plist（EXUpdatesRequestHeaders の expo-channel-name）に書き込む
# prebuild を先に自分で行う。app.config.ts が EXPO_UPDATES_CHANNEL を
# updates.requestHeaders に変換する。
pnpm expo prebuild -p ios --no-install

exec pnpm expo run:ios --device --configuration Release --no-bundler "$@"
