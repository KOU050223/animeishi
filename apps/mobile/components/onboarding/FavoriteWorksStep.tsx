import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Button, Input } from "@/components/ui";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { useWorkCandidates, type WorkCandidate } from "@/lib/useWorkCandidates";
import { useThemeColors } from "@/lib/theme";
import { OnboardingScaffold } from "./OnboardingScaffold";

export const ONBOARDING_FAVORITE_COUNT = 3;

const SEARCH_DEBOUNCE_MS = 300;

/** 入力のたびに検索を発火しないよう、値の反映を遅らせる（useAnimeList と同じ方式）。 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * オンボーディング 1 問目（issue #412）: 名刺に載せる推し作品を 3 つ選ぶ。
 * 候補は /works/candidates（annict_works キャッシュ）から出すので
 * Annict 未連携の新規ユーザーでも選べる。
 * 確定（favorites への保存）は次へボタン側で行い、この画面は選択だけを持つ。
 */
export function FavoriteWorksStep({
  stepIndex,
  totalSteps,
  selected,
  onToggle,
  onNext,
  saving,
  error,
  onSkip,
}: {
  stepIndex: number;
  totalSteps: number;
  selected: WorkCandidate[];
  onToggle: (work: WorkCandidate) => void;
  /** 「次へ」。3 作選択済みのときだけ有効。 */
  onNext: () => void;
  saving: boolean;
  error: string | null;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const { data, isLoading } = useWorkCandidates(debouncedQuery);

  const selectedIds = new Set(selected.map((w) => w.annictWorkId));

  return (
    <OnboardingScaffold
      stepIndex={stepIndex}
      totalSteps={totalSteps}
      title={t("好きな作品を 3 つ選んでください")}
      subtitle={t("名刺に載せる「推し」作品です。あとから変更できます。")}
      onSkip={onSkip}
      footer={
        <View>
          <Text className="mb-2 text-center text-sm text-slate-500 dark:text-slate-400">
            {t("{{count}} / 3 作品選択中", { count: selected.length })}
          </Text>
          {error ? (
            <Text
              className="mb-2 text-center text-sm text-red-500 dark:text-red-400"
              testID="onboarding-favorites-error"
            >
              {error}
            </Text>
          ) : null}
          <Button
            label={t("次へ")}
            onPress={onNext}
            loading={saving}
            disabled={selected.length !== ONBOARDING_FAVORITE_COUNT}
            testID="onboarding-favorites-next"
          />
        </View>
      }
    >
      <Input
        className="mb-2 rounded-lg border border-slate-300 px-4 py-3 text-base dark:border-slate-600 dark:text-slate-100"
        placeholder={t("作品を検索")}
        value={query}
        onChangeText={setQuery}
        testID="onboarding-work-search"
      />
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data?.works ?? []}
          keyExtractor={(item) => String(item.annictWorkId)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item.annictWorkId);
            return (
              <Pressable
                onPress={() => onToggle(item)}
                className="flex-row items-center border-b border-slate-100 py-2 dark:border-slate-800"
                testID={`onboarding-work-${item.annictWorkId}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <WorkThumbnail uri={item.hostedImageUrl} title={item.title} />
                <View className="ml-3 flex-1">
                  <Text
                    className="text-base font-medium text-slate-900 dark:text-slate-100"
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  {item.titleEn ? (
                    <Text
                      className="text-xs text-slate-500 dark:text-slate-400"
                      numberOfLines={1}
                    >
                      {item.titleEn}
                    </Text>
                  ) : null}
                </View>
                <Ionicons
                  name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                  size={24}
                  color={isSelected ? colors.primary : colors.textFaint}
                />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View className="items-center py-10">
              <Text className="text-sm text-slate-500 dark:text-slate-400">
                {t("作品が見つかりませんでした")}
              </Text>
            </View>
          }
        />
      )}
    </OnboardingScaffold>
  );
}
