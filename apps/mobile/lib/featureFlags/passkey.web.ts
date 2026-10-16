// パスキー（issue #181）。Web は signIn.authenticateWithPasskey /
// user.createPasskey で実現できる。
// 開発インスタンスでは used_for_sign_in 有効化済みだが、本番インスタンスは
// Clerk の現行プランではパスキーを有効化できないため本番キーでは既定 OFF。
// googleSignIn と同じく publishable key の種別でも判定する。
// EXPO_PUBLIC_FEATURE_PASSKEY=true/false で環境に関わらず上書きできる。
const override = process.env.EXPO_PUBLIC_FEATURE_PASSKEY;
const clerkKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const isProductionClerk = clerkKey.startsWith("pk_live_");
export const passkey =
  override === "true"
    ? true
    : override === "false"
      ? false
      : process.env.EXPO_PUBLIC_ENVIRONMENT !== "production" &&
        !isProductionClerk;
