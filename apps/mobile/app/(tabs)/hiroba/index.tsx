import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { SegmentedControl } from "@/components/ui";
import { CreateSection } from "@/components/hiroba/CreateSection";
import { DiscoverSection } from "@/components/hiroba/DiscoverSection";
import { useMarkScreenInteractive } from "@/lib/observe";

const SECTIONS = ["create", "discover"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(value: unknown): value is Section {
  return SECTIONS.includes(value as Section);
}

// ひろばタブ（issue #352）。Tier 表・作品リスト・アニメ分析など
// 「作って遊ぶ」機能を束ねる。レイアウトはライブラリ・QR・フレンドと
// 同じく、ラージタイトルの下にセグメント「つくる / みつける」を置く。
// みつけるは公開作品リスト（#422）・公開 tier 表・公開名刺（#418）の一覧。
// section は URL パラメータで制御し、フィードの空状態から
// 「みつける」へ直接誘導できるようにする（issue #533）。
export default function HirobaScreen() {
  const { t } = useTranslation();
  useMarkScreenInteractive();
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
  // 参照元にする（social タブと同じ考え方）。
  const section = isSection(params.section) ? params.section : "create";
  const setSection = (next: Section) => router.setParams({ section: next });

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
            label: t("つくる"),
            active: section === "create",
            onPress: () => setSection("create"),
            testID: "hiroba-section-create",
          },
          {
            label: t("みつける"),
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
