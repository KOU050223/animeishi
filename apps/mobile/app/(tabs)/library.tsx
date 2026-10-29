import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { SegmentedControl } from "@/components/ui";
import { AnimeSection } from "@/components/library/AnimeSection";
import { WatchHistorySection } from "@/components/library/WatchHistorySection";
import { FavoritesSection } from "@/components/library/FavoritesSection";
import { useThemeColors } from "@/lib/theme";
import { useAnimeListPalette } from "@/components/anime-list/animeListStyles";

const SECTIONS = ["anime", "history", "favorites"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(value: unknown): value is Section {
  return SECTIONS.includes(value as Section);
}

// ライブラリタブ。アニメ一覧・検索 / 視聴履歴 / 推し（お気に入り）を
// 上部のセグメント切り替えで行き来する（issue #170）。
// 旧タブのパス（/watch-history 等）は app/ 直下のリダイレクトから
// /library?section=... でここへ着地する。
export default function LibraryScreen() {
  const colors = useThemeColors();
  const animePalette = useAnimeListPalette();
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
        : "anime";
  const setSection = (next: Section) =>
    setOverride({ key: params.section, value: next });

  // セクションごとの画面背景色に切り替え行の下地を揃える
  // （アニメは暖色系の独自パレット、他は共通の白/slate-900）。
  const backgroundColor =
    section === "anime" ? animePalette.screen : colors.background;

  return (
    // 上端だけ safe area を取る。下端はタブバー側で吸収する。
    <SafeAreaView style={{ flex: 1, backgroundColor }} edges={["top"]}>
      <SegmentedControl
        items={[
          {
            label: "アニメ",
            active: section === "anime",
            onPress: () => setSection("anime"),
            testID: "library-section-anime",
          },
          {
            label: "視聴履歴",
            active: section === "history",
            onPress: () => setSection("history"),
            testID: "library-section-history",
          },
          {
            label: "推し",
            accessibilityLabel: "お気に入り",
            active: section === "favorites",
            onPress: () => setSection("favorites"),
            testID: "library-section-favorites",
          },
        ]}
      />
      <View className="flex-1">
        {section === "anime" ? (
          <AnimeSection />
        ) : section === "history" ? (
          <WatchHistorySection />
        ) : (
          <FavoritesSection />
        )}
      </View>
    </SafeAreaView>
  );
}
