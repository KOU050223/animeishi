import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  ANIME_LIST_MEDIA_KEYS,
  ANIME_LIST_MEDIA_LABELS,
  NO_ANIME_LIST_FILTERS,
  UNKNOWN_GENRE_KEY,
  type AnimeListFilters,
  type AnimeListMedia,
} from "@/lib/animeListSortFilter";

/**
 * メディア種別・ジャンル/タグの絞り込みシート（issue #346）。
 * 選択は即時に一覧へ反映し、「閉じる」またはスワイプで閉じる。
 * 構造は視聴履歴の絞り込みシート（WatchHistorySection の FilterSheet）に揃える。
 */
export function AnimeListFilterSheet({
  genreOptions,
  filters,
  onChange,
  onClose,
}: {
  /** 一覧に出る作品から集めたジャンル選択肢（"不明" は UNKNOWN_GENRE_KEY）。 */
  genreOptions: string[];
  filters: AnimeListFilters;
  onChange: (next: AnimeListFilters) => void;
  onClose: () => void;
}) {
  const toggleGenre = (genre: string) =>
    onChange({
      ...filters,
      genres: filters.genres.includes(genre)
        ? filters.genres.filter((g) => g !== genre)
        : [...filters.genres, genre],
    });

  const selectMedia = (media: AnimeListMedia | null) =>
    onChange({ ...filters, media });

  const genreLabel = (key: string) =>
    key === UNKNOWN_GENRE_KEY ? "不明" : key;

  return (
    <BottomSheet
      visible
      onClose={onClose}
      scrimAccessibilityLabel="絞り込みを閉じる"
      testID="anime-list-filter-sheet"
    >
      <View className="px-6 pt-6 pb-10">
        <Text className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-5">
          絞り込み
        </Text>

        <Text className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
          メディア種別
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-5">
          <SelectChip
            label="すべて"
            selected={filters.media === null}
            onPress={() => selectMedia(null)}
            accessibilityLabel="すべてのメディア種別"
            testID="anime-filter-media-all"
          />
          {ANIME_LIST_MEDIA_KEYS.map((key) => (
            <SelectChip
              key={key}
              label={ANIME_LIST_MEDIA_LABELS[key]}
              selected={filters.media === key}
              onPress={() => selectMedia(key)}
              accessibilityLabel={`${ANIME_LIST_MEDIA_LABELS[key]}で絞り込む`}
              testID={`anime-filter-media-${key}`}
            />
          ))}
        </View>

        <Text className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
          ジャンル・タグ
        </Text>
        {genreOptions.length > 0 ? (
          // ジャンルは選択肢が多くなりうるため、シート内で縦にスクロールする。
          <ScrollView className="max-h-56 mb-2">
            <View className="flex-row flex-wrap gap-2">
              {genreOptions.map((genre) => (
                <SelectChip
                  key={genre}
                  label={genreLabel(genre)}
                  selected={filters.genres.includes(genre)}
                  onPress={() => toggleGenre(genre)}
                  accessibilityLabel={`${genreLabel(genre)}で絞り込む`}
                  testID={`anime-filter-genre-${genre}`}
                />
              ))}
            </View>
          </ScrollView>
        ) : (
          <Text className="text-xs text-gray-400 dark:text-slate-500 mb-2">
            表示中の作品にジャンル情報がありません（順次取り込み中です）。
          </Text>
        )}
        <Text className="text-xs text-gray-400 dark:text-slate-500 mb-5">
          ジャンルを複数選ぶといずれかに一致する作品を表示します。「不明」は
          ジャンルが未取得の作品だけを表示します。
        </Text>

        <View className="flex-row gap-3">
          <TouchableOpacity
            className="flex-1 border border-gray-200 dark:border-slate-600 rounded-xl py-3 items-center"
            onPress={() => onChange(NO_ANIME_LIST_FILTERS)}
            accessibilityRole="button"
            accessibilityLabel="絞り込みをリセット"
            testID="anime-filter-reset"
          >
            <Text className="text-gray-600 dark:text-slate-300 font-medium">
              リセット
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-indigo-600 rounded-xl py-3 items-center"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="絞り込みを適用して閉じる"
            testID="anime-filter-close"
          >
            <Text className="text-white font-semibold">閉じる</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

// 絞り込みの選択チップ。視聴履歴の SelectChip と同じ見た目。
function SelectChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`px-3 py-1.5 rounded-full border ${
        selected
          ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
          : "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800"
      }`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      <Text
        className={`text-xs font-medium ${
          selected
            ? "text-indigo-600 dark:text-indigo-300"
            : "text-gray-500 dark:text-slate-400"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
