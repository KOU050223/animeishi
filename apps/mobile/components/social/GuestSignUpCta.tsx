import { useEffect } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/events";

/**
 * 未ログインで公開プロフィールを開いた人向けの下部固定 CTA（issue #562）。
 * スクロール領域の外（画面下端）に置き、内容の末尾を隠さない。
 * 表示時に guest_cta_view を送り、タップの計測と遷移は onPress 側で行う。
 */
export function GuestSignUpCta({
  username,
  onPress,
}: {
  username: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    // 画面進入直後はルートレイアウトの screen 同期より先に走りうるため明示する。
    trackEvent(
      "guest_cta_view",
      { source: "profile" },
      { screen: "user/[uid]" },
    );
  }, []);

  return (
    <View
      className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 pt-3 pb-3"
      testID="guest-cta"
    >
      <Text className="text-xs text-slate-500 dark:text-slate-400 text-center mb-2">
        {t("登録すると {{username}} さんにフレンド申請できます", { username })}
      </Text>
      <TouchableOpacity
        className="w-full max-w-[480px] self-center bg-indigo-600 rounded-lg px-4 py-3 items-center"
        onPress={onPress}
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
