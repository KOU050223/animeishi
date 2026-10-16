// Google ログイン（issue #89）。
// 開発インスタンスでは Google OAuth が有効（Clerk 共有クレデンシャル）だが、
// 本番インスタンスでは OAuth クライアント未設定のため production では既定 OFF。
// dev / preview では既定 ON。EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN=true/false で
// 環境に関わらず明示的に上書きできる（本番で有効化する場合もこの変数を使う）。
const override = process.env.EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN;
export const googleSignIn =
  override === "true"
    ? true
    : override === "false"
      ? false
      : process.env.EXPO_PUBLIC_ENVIRONMENT !== "production";
