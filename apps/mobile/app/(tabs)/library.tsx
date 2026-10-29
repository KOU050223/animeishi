import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SegmentedControl } from "@/components/ui";
import { AnimeSection } from "@/components/library/AnimeSection";
import { WatchHistorySection } from "@/components/library/WatchHistorySection";
import { FavoritesSection } from "@/components/library/FavoritesSection";
import { useThemeColors } from "@/lib/theme";
import { useMarkScreenInteractive } from "@/lib/observe";
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
  useMarkScreenInteractive();
  const colors = useThemeColors();
  const animePalette = useAnimeListPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  // セグメント操作も URL の section に反映し、URL を表示状態の唯一の
  // 参照元にする。ローカル状態で持つと、同じ section への再遷移
  // （ホームの QR ボタン等）を新しいナビゲーションと区別できない。
  const section = isSection(params.section) ? params.section : "anime";
  const setSection = (next: Section) => router.setParams({ section: next });

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
