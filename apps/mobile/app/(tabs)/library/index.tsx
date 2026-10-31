import { View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
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
  // ネイティブヘッダーは透過のため、固定配置のセグメント切り替えは
  // ヘッダー高さ分だけ下げる（large title が畳まれると値も変わる）。
  const headerHeight = useHeaderHeight();
  const colors = useThemeColors();
  const animePalette = useAnimeListPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string; q?: string }>();
  // セグメント操作も URL の section に反映し、URL を表示状態の唯一の
  // 参照元にする。ローカル状態で持つと、同じ section への再遷移
  // （ホームの QR ボタン等）を新しいナビゲーションと区別できない。
  const section = isSection(params.section) ? params.section : "anime";
  const setSection = (next: Section) => router.setParams({ section: next });

  // おすすめ画面（issue #335）等からの検索遷移で初期クエリを受け取る。
  // q も URL を参照元にし、変わったときは AnimeListContent が key で
  // リマウントして検索語を入れ直す。検索欄の編集は q を書き戻さない
  // （section 同様「最後に深リンクで指定された検索語」として残る）。
  const initialQuery =
    typeof params.q === "string" && params.q ? params.q : undefined;

  // セクションごとの画面背景色に切り替え行の下地を揃える
  // （アニメは暖色系の独自パレット、他は共通の白/slate-900）。
  const backgroundColor =
    section === "anime" ? animePalette.screen : colors.background;

  return (
    // 上端はネイティブの large title、下端はタブバーが safe area を吸収する。
    <SafeAreaView
      style={{ flex: 1, backgroundColor, paddingTop: headerHeight }}
      edges={[]}
    >
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
          <AnimeSection initialQuery={initialQuery} />
        ) : section === "history" ? (
          <WatchHistorySection />
        ) : (
          <FavoritesSection />
        )}
      </View>
    </SafeAreaView>
  );
}
