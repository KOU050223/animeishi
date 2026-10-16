// Google ログイン（issue #89）。
// Google OAuth が有効なのは開発インスタンスのみ（Clerk 共有クレデンシャル）。
// 本番インスタンスでは OAuth クライアント未設定のため、接続先インスタンスを
// publishable key の種別で判定して既定値を決める（pk_test_=開発のみ ON。
// EAS preview ビルドも本番キー pk_live_ を指す点に注意）。
// EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN=true/false で環境に関わらず
// 明示的に上書きできる（本番で有効化する場合もこの変数を使う）。
const override = process.env.EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN;
const clerkKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
export const googleSignIn =
  override === "true"
    ? true
    : override === "false"
      ? false
      : clerkKey.startsWith("pk_test_");
