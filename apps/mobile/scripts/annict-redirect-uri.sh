#!/usr/bin/env bash
# Expo Go 実機用の Annict redirect_uri を表示する。
set -euo pipefail

ip="$(ipconfig getifaddr en0 || ipconfig getifaddr en1)"
if [ -z "$ip" ]; then
  echo "Wi-Fi/LAN の IP アドレスを取得できませんでした"
  exit 1
fi
echo "Annict の redirect_uri に登録:"
echo "exp://$ip:8081/--/annict"
echo
echo "development build / standalone の場合:"
echo "animeishi://annict"
