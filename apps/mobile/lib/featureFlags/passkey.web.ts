// パスキー（issue #181）。Web は signIn.authenticateWithPasskey /
// user.createPasskey で実現できる。
// 開発インスタンスでは used_for_sign_in 有効化済みだが、本番インスタンスは
// Clerk の現行プランではパスキーを有効化できないため production では既定 OFF。
// EXPO_PUBLIC_FEATURE_PASSKEY=true/false で環境に関わらず上書きできる。
const override = process.env.EXPO_PUBLIC_FEATURE_PASSKEY;
export const passkey =
  override === "true"
    ? true
    : override === "false"
      ? false
      : process.env.EXPO_PUBLIC_ENVIRONMENT !== "production";
