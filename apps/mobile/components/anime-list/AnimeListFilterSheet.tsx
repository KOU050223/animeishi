import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  animeGenreJapaneseName,
  matchesAnimeGenreSearch,
} from "@/lib/animeGenreTags";
import {
  ANIME_LIST_MEDIA_KEYS,
  ANIME_LIST_MEDIA_LABELS,
  NO_ANIME_LIST_FILTERS,
  UNKNOWN_GENRE_KEY,
  type AnimeListFilters,
  type AnimeListMedia,
} from "@/lib/animeListSortFilter";

export function AnimeListFilterSheet({
  genreOptions,
  filters,
  onChange,
  onClose,
}: {
  genreOptions: { key: string; count: number }[];
  filters: AnimeListFilters;
  onChange: (next: AnimeListFilters) => void;
  onClose: () => void;
}) {
  const { t: translate } = useTranslation();
  // 動的なタグ名を翻訳キーの型集合へ足すと、無関係な画面で型の展開上限を超える。
  const t = translate as (
    key: string,
    options?: Record<string, string | number>,
  ) => string;
  const [genreQuery, setGenreQuery] = useState("");
  const selectedGenres = new Set(filters.genres);
  const toggleGenre = (genre: string) =>
    onChange({
      ...filters,
      genres: selectedGenres.has(genre)
        ? filters.genres.filter((g) => g !== genre)
        : [...filters.genres, genre],
    });

  const selectMedia = (media: AnimeListMedia | null) =>
    onChange({ ...filters, media });

  const genreLabel = (key: string) => {
    if (key === UNKNOWN_GENRE_KEY) return t("不明");
    const name = animeGenreJapaneseName(key);
    return name === key ? key : t(name, { defaultValue: name });
  };
  const visibleGenres = genreOptions.filter(({ key }) =>
    matchesAnimeGenreSearch(key, genreLabel(key), genreQuery),
  );

  return (
    <BottomSheet
      visible
      onClose={onClose}
      scrimAccessibilityLabel={t("絞り込みを閉じる")}
      testID="anime-list-filter-sheet"
    >
      <View className="px-6 pt-6 pb-10">
        <Text className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-5">
          {t("絞り込み")}
        </Text>

        <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
          {t("メディア種別")}
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-5">
          <SelectChip
            label={t("すべて")}
            selected={filters.media === null}
            onPress={() => selectMedia(null)}
            accessibilityLabel={t("すべてのメディア種別")}
            testID="anime-filter-media-all"
          />
          {ANIME_LIST_MEDIA_KEYS.map((key) => (
            <SelectChip
              key={key}
              label={t(ANIME_LIST_MEDIA_LABELS[key], {
                defaultValue: ANIME_LIST_MEDIA_LABELS[key],
              })}
              selected={filters.media === key}
              onPress={() => selectMedia(key)}
              accessibilityLabel={t("{{name}}で絞り込む", {
                name: t(ANIME_LIST_MEDIA_LABELS[key], {
                  defaultValue: ANIME_LIST_MEDIA_LABELS[key],
                }),
              })}
              testID={`anime-filter-media-${key}`}
            />
          ))}
        </View>

        <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
          {t("ジャンル・タグ")}
        </Text>
        {genreOptions.length > 0 ? (
          <TextInput
            value={genreQuery}
            onChangeText={setGenreQuery}
            placeholder={t("タグを検索")}
            accessibilityLabel={t("タグを検索")}
            testID="anime-filter-genre-search"
            className="border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 mb-3 text-slate-900 dark:text-slate-100"
          />
        ) : null}
        {genreOptions.length > 0 ? (
          <ScrollView
            className="max-h-56 mb-2"
            keyboardShouldPersistTaps="handled"
          >
            <View className="flex-row flex-wrap gap-2">
              {visibleGenres.map(({ key, count }) => (
                <SelectChip
                  key={key}
                  label={t("{{name}}（{{count}}）", {
                    name: genreLabel(key),
                    count,
                  })}
                  selected={selectedGenres.has(key)}
                  onPress={() => toggleGenre(key)}
                  accessibilityLabel={t("{{name}}、{{count}}作品で絞り込む", {
                    name: genreLabel(key),
                    count,
                  })}
                  testID={`anime-filter-genre-${key}`}
                />
              ))}
            </View>
          </ScrollView>
        ) : (
          <Text className="text-xs text-muted mb-2">
            {t(
              "表示中の作品にジャンル情報がありません（順次取り込み中です）。",
            )}
          </Text>
        )}
        {genreOptions.length > 0 && visibleGenres.length === 0 ? (
          <Text className="text-xs text-muted mb-2">
            {t("一致するタグがありません")}
          </Text>
        ) : null}
        <Text className="text-xs text-muted mb-5">
          {t(
            "ジャンルを複数選ぶといずれかに一致する作品を表示します。「不明」はジャンルが未取得の作品だけを表示します。",
          )}
        </Text>

        <View className="flex-row gap-3">
          <TouchableOpacity
            className="flex-1 border border-slate-200 dark:border-slate-600 rounded-xl py-3 items-center"
            onPress={() => onChange(NO_ANIME_LIST_FILTERS)}
            accessibilityRole="button"
            accessibilityLabel={t("絞り込みをリセット")}
            testID="anime-filter-reset"
          >
            <Text className="text-slate-600 dark:text-slate-300 font-medium">
              {t("リセット")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-indigo-600 rounded-xl py-3 items-center"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("絞り込みを適用")}
            testID="anime-filter-close"
          >
            <Text className="text-white font-semibold">
              {t("絞り込みを適用")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

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
          : "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
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
            : "text-slate-500 dark:text-slate-400"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
