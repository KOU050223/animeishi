import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useHeaderHeight } from "expo-router/react-navigation";
import { SegmentedControl } from "@/components/ui";
import { CreateSection } from "@/components/hiroba/CreateSection";
import { DiscoverSection } from "@/components/hiroba/DiscoverSection";
import { useMarkScreenInteractive } from "@/lib/observe";

// ひろばタブ（issue #352）。Tier 表・作品リスト・アニメ分析など
// 「作って遊ぶ」機能を束ねる。レイアウトはライブラリ・QR・フレンドと
// 同じく、ラージタイトルの下にセグメント「つくる / みつける」を置く。
// みつけるは公開作品リストの一覧（#422）。
export default function HirobaScreen() {
  useMarkScreenInteractive();
  // ネイティブヘッダーは透過のため、固定配置のセグメント切り替えは
  // ヘッダー高さ分だけ下げる（large title が畳まれると値も変わる）。
  const headerHeight = useHeaderHeight();
  const [section, setSection] = useState<"create" | "discover">("create");

  return (
    // 上端はネイティブの large title、下端はタブバーが safe area を吸収する。
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={[]}
      style={{ paddingTop: headerHeight }}
    >
      <SegmentedControl
        items={[
          {
            label: "つくる",
            active: section === "create",
            onPress: () => setSection("create"),
            testID: "hiroba-section-create",
          },
          {
            label: "みつける",
            active: section === "discover",
            onPress: () => setSection("discover"),
            testID: "hiroba-section-discover",
          },
        ]}
      />
      <View className="flex-1">
        {section === "create" ? <CreateSection /> : <DiscoverSection />}
      </View>
    </SafeAreaView>
  );
}
