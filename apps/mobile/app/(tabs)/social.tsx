import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
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
  const params = useLocalSearchParams<{ section?: string }>();
  // セグメント操作はローカルに保持し、section パラメータが変わった
  // タイミング（リダイレクト・ディープリンク）ではパラメータ側を優先する。
  // effect で同期すると再描画が 1 回多くなるため、パラメータ値をキーにして
  // 描画中に導出する。
  const [override, setOverride] = useState<{
    key: string | undefined;
    value: Section;
  } | null>(null);
  const section =
    override && override.key === params.section
      ? override.value
      : isSection(params.section)
        ? params.section
        : "qr";
  const setSection = (next: Section) =>
    setOverride({ key: params.section, value: next });

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
