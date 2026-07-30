import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { SeasonFilter } from "@/components/anime-list/SeasonFilter";
import {
  currentSeasonKey,
  toSeasonParam,
  type SeasonKey,
} from "@/components/anime-list/animeListUtils";
import { TierBoard } from "@/components/tier-list/TierBoard";
import { styles } from "@/components/tier-list/tierListStyles";
import {
  assignWork,
  parseTiersJson,
  toAssignment,
  toSaveItems,
} from "@/lib/tierList/board";
import { DEFAULT_TIERS, defaultTierListTitle } from "@/lib/tierList/defaults";
import type { TierAssignment, TierRow } from "@/lib/tierList/types";
import { useSeasonWorks } from "@/lib/tierList/useSeasonWorks";
import { useSavedTierList, useSaveTierList } from "@/lib/tierList/useTierList";

/**
 * シーズン単位のアニメ tier 表を作る画面。
 *
 * シーズンの全作品を未分類トレイに並べ、長押しドラッグで各 tier 行へ振り分ける。
 * 保存は明示的な操作（保存ボタン）で行う。ドロップのたびに PUT すると、
 * 数十回の並べ替えがそのまま数十リクエストになるため。
 */
export default function TierListScreen() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [seasonKey, setSeasonKey] = useState<SeasonKey>(() =>
    currentSeasonKey(),
  );
  const season = toSeasonParam(year, seasonKey);

  const {
    works,
    isLoading: isWorksLoading,
    isConnected,
    isConnectionLoading,
  } = useSeasonWorks(season);
  const { data: saved, isLoading: isSavedLoading } = useSavedTierList(season);
  const save = useSaveTierList();

  const [tiers, setTiers] = useState<TierRow[]>(DEFAULT_TIERS);
  const [assignment, setAssignment] = useState<TierAssignment>(new Map());
  const [title, setTitle] = useState(() => defaultTierListTitle(season));
  // 未保存の変更があるか。保存ボタンの活性と「保存済み」表示の出し分けに使う。
  const [isDirty, setIsDirty] = useState(false);

  // シーズンを切り替えたら、そのシーズンの保存済みデータ（あれば）で状態を差し替える。
  // 保存済みが無ければ既定の tier と空の配置に戻す。
  useEffect(() => {
    if (isSavedLoading) return;
    if (saved) {
      setTiers(parseTiersJson(saved.tiersJson) ?? DEFAULT_TIERS);
      setAssignment(toAssignment(saved.items));
      setTitle(saved.title);
    } else {
      setTiers(DEFAULT_TIERS);
      setAssignment(new Map());
      setTitle(defaultTierListTitle(season));
    }
    setIsDirty(false);
  }, [saved, isSavedLoading, season]);

  const handleAssign = useCallback(
    (annictWorkId: number, tierKey: string | null) => {
      setAssignment((prev) => assignWork(prev, annictWorkId, tierKey));
      setIsDirty(true);
    },
    [],
  );

  const handleSave = useCallback(() => {
    save.mutate(
      { season, title, tiers, items: toSaveItems(assignment, tiers) },
      { onSuccess: () => setIsDirty(false) },
    );
  }, [assignment, save, season, tiers, title]);

  if (isConnectionLoading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator color="#9ca3af" />
        </View>
      </SafeAreaView>
    );
  }

  if (!isConnected) {
    // シーズン作品の取得は /works/search 経由で Annict トークン必須。
    // 未連携では盤面自体が空になるため、連携誘導を最優先で出す。
    return (
      <SafeAreaView style={styles.screen}>
        <AnnictSoftGate
          description="Tier 表の作成には Annict との連携が必要です。連携するとシーズンの全作品を並べ替えられます。"
          testID="tier-list-soft-gate"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerHint}>
          作品を長押ししてドラッグすると tier を移動できます
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[
              styles.saveButton,
              (!isDirty || save.isPending) && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!isDirty || save.isPending}
            accessibilityRole="button"
            accessibilityLabel="tier 表を保存"
            accessibilityState={{ disabled: !isDirty || save.isPending }}
            testID="tier-list-save"
          >
            {save.isPending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>
                {isDirty ? "保存" : "保存済み"}
              </Text>
            )}
          </TouchableOpacity>
          {save.isError && (
            <Text style={styles.centeredText}>保存に失敗しました</Text>
          )}
        </View>
      </View>

      <SeasonFilter
        year={year}
        season={seasonKey}
        onChangeYear={setYear}
        onChangeSeason={setSeasonKey}
      />

      {isWorksLoading || isSavedLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#9ca3af" />
          <Text style={styles.centeredText}>シーズンの作品を集めています</Text>
        </View>
      ) : works.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            このシーズンの作品が見つかりませんでした
          </Text>
        </View>
      ) : (
        <TierBoard
          tiers={tiers}
          works={works}
          assignment={assignment}
          onAssign={handleAssign}
        />
      )}
    </SafeAreaView>
  );
}
