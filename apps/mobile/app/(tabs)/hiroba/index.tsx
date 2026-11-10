import { useState } from "react";
import { Platform, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useHeaderHeight } from "expo-router/react-navigation";
import { SegmentedControl } from "@/components/ui";
import { CreateSection } from "@/components/hiroba/CreateSection";
import { DiscoverSection } from "@/components/hiroba/DiscoverSection";
import { useMarkScreenInteractive } from "@/lib/observe";

// ひろばタブ（issue #352）。Tier 表・作品リスト・アニメ分析など
// 「作って遊ぶ」機能を束ねる。レイアウトはライブラリ・QR・フレンドと
// 同じく、ラージタイトルの下にセグメント「つくる / みつける」を置く。
// みつけるは公開作品リスト（#422）・公開 tier 表・公開名刺（#418）の一覧。
export default function HirobaScreen() {
  useMarkScreenInteractive();
  // iOS のネイティブヘッダーは large title 指定で透過になりコンテンツが
  // 下に潜り込むため、固定配置のセグメント切り替えはヘッダー高さ分だけ
  // 下げる（large title が畳まれると値も変わる）。Android/Web はヘッダーが
  // 不透明でコンテンツがバー下から始まるため、同じ余白を取ると
  // ヘッダー下に空白ができてしまう（issue #491）。
  const headerHeight = useHeaderHeight();
  const contentTopPadding = Platform.OS === "ios" ? headerHeight : 0;
  const [section, setSection] = useState<"create" | "discover">("create");

  return (
    // 上端はネイティブの large title、下端はタブバーが safe area を吸収する。
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={[]}
      style={{ paddingTop: contentTopPadding }}
      testID="hiroba-screen"
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
