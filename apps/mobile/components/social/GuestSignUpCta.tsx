import { useEffect } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/events";
import { profileReturnPath, savePendingReturn } from "@/lib/guestCta";

/**
 * 未ログインで公開プロフィールを開いた人向けの下部固定 CTA（issue #562）。
 * 名刺 QR を読んだアプリ未導入の人が行き止まりにならないよう、登録へ誘導する。
 * スクロール領域の外（画面下端）に置き、内容の末尾を隠さない。
 * Clerk の読み込み前とサインイン済みでは出さない。
 */
export function GuestSignUpCta({
  uid,
  username,
}: {
  uid: string | undefined;
  username: string;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded || isSignedIn) return null;
  return <GuestSignUpCtaBar uid={uid} username={username} />;
}

function GuestSignUpCtaBar({
  uid,
  username,
}: {
  uid: string | undefined;
  username: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    // 画面進入直後はルートレイアウトの screen 同期より先に走りうるため明示する。
    trackEvent(
      "guest_cta_view",
      { source: "profile" },
      { screen: "user/[uid]" },
    );
  }, []);

  // App Store 公開（#107）までは Web 版の新規登録へ誘導する。登録・オンボーディング
  // の後は useGuestCtaReturn（ルートレイアウト）がこのプロフィールへ戻す。
  const handlePress = () => {
    trackEvent("guest_cta_tap", { source: "profile" });
    const returnPath = uid ? profileReturnPath(uid) : null;
    if (returnPath) void savePendingReturn(returnPath);
    router.push("/(auth)/sign-up");
  };

  return (
    <View
      className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 pt-3 pb-3"
      testID="guest-cta"
    >
      <Text className="text-xs text-muted text-center mb-2">
        {t("登録すると {{username}} さんにフレンド申請できます", { username })}
      </Text>
      <TouchableOpacity
        className="w-full max-w-[480px] self-center bg-indigo-600 rounded-lg px-4 py-3 items-center"
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={t("アニ名刺で自分の名刺を作る")}
        testID="guest-cta-button"
      >
        <Text className="text-white font-semibold text-base">
          {t("アニ名刺で自分の名刺を作る")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
