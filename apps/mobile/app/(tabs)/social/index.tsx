import { Platform, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { SegmentedControl } from "@/components/ui";
import { QrSection } from "@/components/social/QrSection";
import { FriendsSection } from "@/components/social/FriendsSection";
import { ActivityFeedSection } from "@/components/social/ActivityFeedSection";
import { useReceivedFriendRequestCount } from "@/lib/useFriendRequests";

const SECTIONS = ["qr", "activity", "friends"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(value: unknown): value is Section {
  return SECTIONS.includes(value as Section);
}

// QR・フレンドタブ。QR（名刺交換）・フレンドの活動・フレンド一覧を上部の
// セグメント切り替えで行き来する（issue #170、#407）。
// 旧タブのパス（/qr, /friends）は app/ 直下のリダイレクトから
// /social?section=... でここへ着地する。
export default function SocialScreen() {
  // iOS のネイティブヘッダーは large title 指定で透過になりコンテンツが
  // 下に潜り込むため、固定配置のセグメント切り替えはヘッダー高さ分だけ
  // 下げる（large title が畳まれると値も変わる）。Android/Web はヘッダーが
  // 不透明でコンテンツがバー下から始まるため、同じ余白を取ると
  // ヘッダー下に空白ができてしまう（issue #491）。
  const headerHeight = useHeaderHeight();
  const contentTopPadding = Platform.OS === "ios" ? headerHeight : 0;
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  // セグメント操作も URL の section に反映し、URL を表示状態の唯一の
  // 参照元にする。ローカル状態で持つと、同じ section への再遷移
  // （ホームの QR ボタン等）を新しいナビゲーションと区別できない。
  const section = isSection(params.section) ? params.section : "activity";
  const setSection = (next: Section) => router.setParams({ section: next });
  // 届いたフレンド申請があることをフレンドセグメントのバッジで知らせる
  // （issue #417。タブバーのバッジと対）。
  const friendRequestCount = useReceivedFriendRequestCount();

  return (
    // 上端はネイティブの large title、下端はタブバーが safe area を吸収する。
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={[]}
      style={{ paddingTop: contentTopPadding }}
      testID="social-screen"
    >
      <SegmentedControl
        items={[
          {
            label: "QR",
            active: section === "qr",
            onPress: () => setSection("qr"),
            testID: "social-section-qr",
          },
          {
            label: "アクティビティ",
            active: section === "activity",
            onPress: () => setSection("activity"),
            testID: "social-section-activity",
          },
          {
            label: "フレンド",
            active: section === "friends",
            onPress: () => setSection("friends"),
            testID: "social-section-friends",
            badgeCount: friendRequestCount,
          },
        ]}
      />
      <View className="flex-1">
        {section === "qr" ? (
          <QrSection />
        ) : section === "friends" ? (
          <FriendsSection />
        ) : (
          <ActivityFeedSection />
        )}
      </View>
    </SafeAreaView>
  );
}
