import { Redirect, useRouter } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PasskeyRegisterPrompt } from "@/components/auth/PasskeyRegisterPrompt";
import { featureFlags } from "@/lib/featureFlags";

/**
 * Web の Google OAuth で新規登録が完了したときだけ着地する
 * パスキー登録促進ルート（issue #332）。
 * handleOAuthRedirect が signUpForceRedirectUrl にこの URL を渡し、
 * サインアップ完了時は clerk-js がここへ遷移させる。
 *
 * (auth) グループの外に置くのは、コールバック後の遷移が
 * window.location によるフルリロードのため passkeyPromptPending の
 * モジュールステートがリセットされ、AuthGuard の「サインイン済みは
 * (auth) からホームへ」で促進画面が追い出されるのを避けるため。
 */
export default function PasskeyPromptScreen() {
  const router = useRouter();

  // フラグ無効の環境へ直接着地した場合は促進を出さずホームへ戻す。
  if (!featureFlags.passkey) {
    return <Redirect href="/" />;
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <View className="flex-1 justify-center px-6 py-10">
        <PasskeyRegisterPrompt onDone={() => router.replace("/(tabs)")} />
      </View>
    </SafeAreaView>
  );
}
