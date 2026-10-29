import { View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SegmentedControl } from "@/components/ui";
import { QrSection } from "@/components/social/QrSection";
import { FriendsSection } from "@/components/social/FriendsSection";

const SECTIONS = ["qr", "friends"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(value: unknown): value is Section {
  return SECTIONS.includes(value as Section);
}

// QR・フレンドタブ。QR（名刺交換）とフレンド一覧を上部のセグメント
// 切り替えで行き来する（issue #170）。
// 旧タブのパス（/qr, /friends）は app/ 直下のリダイレクトから
// /social?section=... でここへ着地する。
export default function SocialScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  // セグメント操作も URL の section に反映し、URL を表示状態の唯一の
  // 参照元にする。ローカル状態で持つと、同じ section への再遷移
  // （ホームの QR ボタン等）を新しいナビゲーションと区別できない。
  const section = isSection(params.section) ? params.section : "qr";
  const setSection = (next: Section) => router.setParams({ section: next });

  return (
    // 上端だけ safe area を取る。下端はタブバー側で吸収する。
    <SafeAreaView className="flex-1 bg-white dark:bg-slate-900" edges={["top"]}>
      <SegmentedControl
        items={[
          {
            label: "QR",
            active: section === "qr",
            onPress: () => setSection("qr"),
            testID: "social-section-qr",
          },
          {
            label: "フレンド",
            active: section === "friends",
            onPress: () => setSection("friends"),
            testID: "social-section-friends",
          },
        ]}
      />
      <View className="flex-1">
        {section === "qr" ? <QrSection /> : <FriendsSection />}
      </View>
    </SafeAreaView>
  );
}
