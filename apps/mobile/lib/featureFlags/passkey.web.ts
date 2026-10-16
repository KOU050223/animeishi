// パスキー（issue #181）。Web は signIn.authenticateWithPasskey /
// user.createPasskey で実現できる。
// 有効化済みなのは開発インスタンスのみ（本番インスタンスは Clerk の現行
// プランでは有効化不可）のため、googleSignIn と同じく publishable key の
// 種別で既定値を決める（pk_test_=開発のみ ON）。
// EXPO_PUBLIC_FEATURE_PASSKEY=true/false で環境に関わらず上書きできる。
const override = process.env.EXPO_PUBLIC_FEATURE_PASSKEY;
const clerkKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
export const passkey =
  override === "true"
    ? true
    : override === "false"
      ? false
      : clerkKey.startsWith("pk_test_");
