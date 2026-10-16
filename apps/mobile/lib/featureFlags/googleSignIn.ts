// Google ログイン（issue #89）。
// 開発インスタンスでは Google OAuth が有効（Clerk 共有クレデンシャル）だが、
// 本番インスタンスでは OAuth クライアント未設定のため本番キーでは既定 OFF。
// EAS preview ビルドも本番キー（pk_live_）を指すため、環境名ではなく
// publishable key の種別でも判定する（pk_test_ は開発インスタンス）。
// EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN=true/false で環境に関わらず
// 明示的に上書きできる（本番で有効化する場合もこの変数を使う）。
const override = process.env.EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN;
const clerkKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const isProductionClerk = clerkKey.startsWith("pk_live_");
export const googleSignIn =
  override === "true"
    ? true
    : override === "false"
      ? false
      : process.env.EXPO_PUBLIC_ENVIRONMENT !== "production" &&
        !isProductionClerk;
