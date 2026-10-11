export const featureFlags = {
  // デバッグ用途パネル。Release ビルドに出ないよう __DEV__ を必須条件にする。
  debugPanel: __DEV__ && process.env.EXPO_PUBLIC_FEATURE_DEBUG_PANEL === "true",
  // Apple Wallet への名刺追加。pkpass 署名が未実装（#103）のため v1.0 では
  // 既定非表示。実装完了後に EXPO_PUBLIC_FEATURE_WALLET=true で有効化する。
  wallet: process.env.EXPO_PUBLIC_FEATURE_WALLET === "true",
} as const;
