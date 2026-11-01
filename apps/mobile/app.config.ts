import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json をベースに、ローカルの実機向け Release ビルドでだけ
// 更新チャネルを注入する（scripts/ios-device-release.sh）。
// EAS Build は eas.json の channel をビルド時にネイティブへ埋め込むが、
// ローカルの prebuild / expo run:ios は eas.json を読まない。
// EXPO_UPDATES_CHANNEL が設定されたときだけ expo-channel-name を
// updates.requestHeaders に足し、Expo.plist の
// EXUpdatesRequestHeaders に書き込ませる。
// 未設定なら config をそのまま返し、EAS・E2E・dev client ビルドには
// 影響しない。
export default ({ config }: ConfigContext): ExpoConfig => {
  const channel = process.env.EXPO_UPDATES_CHANNEL;
  if (!channel) return config as ExpoConfig;
  return {
    ...config,
    updates: {
      ...config.updates,
      requestHeaders: {
        ...config.updates?.requestHeaders,
        "expo-channel-name": channel,
      },
    },
  } as ExpoConfig;
};
