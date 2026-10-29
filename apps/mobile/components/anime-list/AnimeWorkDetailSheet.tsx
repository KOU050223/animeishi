import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useThemeColors } from "@/lib/theme";
import { useWorkDetail, workDetailQueryKey } from "@/lib/useWorkDetail";
import {
  useUpsertWatchHistory,
  WATCH_STATUS_LABELS,
} from "@/lib/useWatchHistory";
import type { UpsertWatchHistoryError } from "@/lib/useWatchHistory";
import type { WorkDetail } from "@/lib/useWorkDetail";
import type { WatchState } from "@/lib/watchStatusLabels";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import type { AnimeTitle } from "@/lib/useAnimeList";
import { AnimePoster } from "./AnimePoster";
import { formatWorkSeason } from "./animeListUtils";
import { useAnimeListPalette } from "./animeListStyles";

const WATCH_STATUSES = Object.keys(WATCH_STATUS_LABELS) as WatchState[];

// Annict Work.media（TV / OVA / MOVIE / WEB / OTHER）の表示ラベル。
const MEDIA_LABELS: Record<string, string> = {
  TV: "TV",
  OVA: "OVA",
  MOVIE: "映画",
  WEB: "Web",
  OTHER: "その他",
};

function normalizeState(state: string | null | undefined): WatchState | null {
  return state && state in WATCH_STATUS_LABELS ? (state as WatchState) : null;
}

/**
 * アニメ一覧カードを押したときに開く作品詳細シート（issue #347）。
 * 一覧から外した「キャラ Tier 表」導線・英語タイトルに加え、視聴ステータスの
 * 変更・推し登録・Annict の詳細情報をまとめて出す。
 * #346（検索軸の追加）が同じ一覧を触るため、一覧本体から独立した
 * コンポーネントにしている。
 */
export function AnimeWorkDetailSheet({
  work,
  onClose,
  isFavorite,
  onToggleFavorite,
  isTogglingFavorite,
  onOpenCharacterTierList,
}: {
  /** 対象作品。null のときシートは閉じる。 */
  work: AnimeTitle | null;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isTogglingFavorite: boolean;
  onOpenCharacterTierList: (work: AnimeTitle) => void;
}) {
  const colors = useThemeColors();
  const palette = useAnimeListPalette();
  const queryClient = useQueryClient();
  const { height } = useWindowDimensions();
  const detail = useWorkDetail(work?.annictWorkId ?? null);
  const upsert = useUpsertWatchHistory();

  // ステータス変更はサーバー応答（viewerStatusState の取り直し）が遅いため、
  // 選択値を楽観表示する。開く作品が変わったら前の楽観値は下ろす
  // （レンダー中の派生 state リセットパターン。effect 同期は避ける）。
  const [optimistic, setOptimistic] = useState<{
    workId: number;
    state: WatchState;
  } | null>(null);
  const serverState = normalizeState(detail.data?.work.state);
  const currentState =
    work && optimistic?.workId === work.annictWorkId
      ? optimistic.state
      : serverState;

  function selectStatus(state: WatchState) {
    if (!work || state === currentState) return;
    trackEvent("watch_status_change", {
      [TRACK_EVENT_KEYS.from]: currentState ?? "NO_STATE",
      [TRACK_EVENT_KEYS.to]: state,
    });
    setOptimistic({ workId: work.annictWorkId, state });
    void upsert
      .mutateAsync({ annictWorkId: work.annictWorkId, data: { state } })
      .catch((e: unknown) => {
        // 楽観値を下ろしてサーバー値に戻す。ロールバックできたかで
        // 「元の状態に戻しました」と言えるかが変わる（視聴履歴と同じ扱い）。
        setOptimistic(null);
        const rolledBack = (e as UpsertWatchHistoryError).rolledBack === true;
        alert(
          "更新できませんでした",
          rolledBack
            ? "視聴ステータスを更新できませんでした。元の状態に戻しました。"
            : "一部の更新に失敗しました。",
          { okLabel: "OK" },
        );
      })
      .finally(() => {
        // viewerStatusState 由来の state を新しい値に取り直す
        void queryClient.invalidateQueries({
          queryKey: workDetailQueryKey(work.annictWorkId),
        });
      });
  }

  const detailWork = detail.data?.work;
  const meta = [
    work ? formatWorkSeason(work) : "",
    detailWork ? (MEDIA_LABELS[detailWork.media] ?? detailWork.media) : null,
  ]
    .filter(Boolean)
    .join("・");

  return (
    <BottomSheet
      visible={work != null}
      onClose={onClose}
      scrimAccessibilityLabel="作品詳細を閉じる"
      testID="anime-work-detail-sheet"
    >
      {work ? (
        <ScrollView style={{ maxHeight: height * 0.8 }}>
          <View className="px-6 pt-6 pb-10 gap-5">
            {/* ポスター・タイトル（日英）・シーズン・メディア種別 */}
            <View className="flex-row gap-4">
              <AnimePoster uri={work.hostedImageUrl} title={work.title} />
              <View className="flex-1 min-w-0 justify-center">
                <Text
                  className="text-lg font-bold text-gray-900 dark:text-slate-100"
                  numberOfLines={3}
                >
                  {work.title}
                </Text>
                {work.titleEn ? (
                  <Text
                    className="mt-1 text-xs text-gray-500 dark:text-slate-400"
                    numberOfLines={2}
                  >
                    {work.titleEn}
                  </Text>
                ) : null}
                {meta ? (
                  <Text className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                    {meta}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* 視聴ステータスの変更（タップで即反映） */}
            <View>
              <Text className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                視聴ステータス
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {WATCH_STATUSES.map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => selectStatus(s)}
                      disabled={upsert.isPending}
                      className={`px-3 py-2 rounded-full border ${
                        currentState === s
                          ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                          : "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800"
                      }`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: currentState === s }}
                      accessibilityLabel={`視聴ステータスを${WATCH_STATUS_LABELS[s]}にする`}
                      testID={`work-detail-status-${s}`}
                    >
                      <Text
                        className={`text-xs font-medium ${
                          currentState === s
                            ? "text-indigo-600 dark:text-indigo-300"
                            : "text-gray-500 dark:text-slate-400"
                        }`}
                      >
                        {WATCH_STATUS_LABELS[s]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* 推し登録とキャラ Tier 表への導線 */}
            <View className="flex-row items-center gap-3">
              <TouchableOpacity
                className="flex-1 flex-row items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white py-2.5 dark:border-slate-600 dark:bg-slate-800"
                onPress={onToggleFavorite}
                disabled={isTogglingFavorite}
                accessibilityRole="button"
                accessibilityLabel={
                  isFavorite
                    ? `${work.title}を推しから解除`
                    : `${work.title}を推しに登録`
                }
                testID="work-detail-favorite"
              >
                <Ionicons
                  name={isFavorite ? "heart" : "heart-outline"}
                  size={16}
                  color={
                    isFavorite
                      ? palette.favoriteIconActive
                      : palette.favoriteIcon
                  }
                />
                <Text className="text-xs font-semibold text-gray-700 dark:text-slate-200">
                  {isFavorite ? "推し登録を解除" : "推しに登録"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 items-center rounded-lg bg-indigo-50 py-2.5 dark:bg-indigo-950"
                onPress={() => onOpenCharacterTierList(work)}
                accessibilityRole="button"
                accessibilityLabel={`${work.title} のキャラクター Tier 表を作る`}
                testID="work-detail-character-tier-list"
              >
                <Text className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  キャラ Tier 表を作る
                </Text>
              </TouchableOpacity>
            </View>

            {/* Annict の詳細情報。読み込み中・失敗はカードの情報だけ表示する */}
            {detail.isLoading ? (
              <View className="items-center py-4">
                <ActivityIndicator size="small" color={colors.textFaint} />
              </View>
            ) : detail.isError ? (
              <View className="items-center py-2 gap-2">
                <Text className="text-xs text-gray-400 dark:text-slate-500">
                  詳細情報を取得できませんでした
                </Text>
                <TouchableOpacity
                  onPress={() => detail.refetch()}
                  accessibilityRole="button"
                  accessibilityLabel="詳細情報を再取得"
                  testID="work-detail-retry"
                >
                  <Text className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                    再試行
                  </Text>
                </TouchableOpacity>
              </View>
            ) : detailWork ? (
              <WorkDetailSection work={detailWork} />
            ) : null}
          </View>
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-xs text-gray-400 dark:text-slate-500">{label}</Text>
      <Text className="text-xs font-semibold text-gray-700 dark:text-slate-200">
        {value}
      </Text>
    </View>
  );
}

function DetailLink({
  label,
  url,
  color,
}: {
  label: string;
  url: string;
  color: string;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center gap-1.5 py-1"
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Ionicons name="open-outline" size={13} color={color} />
      <Text className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function WorkDetailSection({ work }: { work: WorkDetail }) {
  const colors = useThemeColors();

  const episodes =
    work.noEpisodes || work.episodesCount === 0
      ? "話数未定"
      : `全${work.episodesCount}話`;
  const rows: { label: string; value: string }[] = [
    { label: "話数", value: episodes },
    { label: "視聴者数", value: `${work.watchersCount.toLocaleString()}人` },
    ...(work.satisfactionRate != null
      ? [
          {
            label: "満足度",
            value: `${Math.round(work.satisfactionRate)}%`,
          },
        ]
      : []),
    ...(work.reviewsCount > 0
      ? [{ label: "レビュー数", value: `${work.reviewsCount}件` }]
      : []),
  ];

  const links: { label: string; url: string }[] = [
    ...(work.officialSiteUrl
      ? [{ label: "公式サイト", url: work.officialSiteUrl }]
      : []),
    ...(work.officialSiteUrlEn
      ? [{ label: "公式サイト（英語）", url: work.officialSiteUrlEn }]
      : []),
    ...(work.wikipediaUrl
      ? [{ label: "Wikipedia", url: work.wikipediaUrl }]
      : []),
    ...(work.wikipediaUrlEn
      ? [{ label: "Wikipedia（英語）", url: work.wikipediaUrlEn }]
      : []),
    ...(work.twitterUsername
      ? [
          {
            label: `X @${work.twitterUsername}`,
            url: `https://x.com/${work.twitterUsername}`,
          },
        ]
      : []),
    ...(work.twitterHashtag
      ? [
          {
            label: `X #${work.twitterHashtag}`,
            url: `https://x.com/hashtag/${work.twitterHashtag}`,
          },
        ]
      : []),
  ];

  return (
    <View className="gap-3">
      <View className="gap-2">
        {rows.map((row) => (
          <DetailRow key={row.label} label={row.label} value={row.value} />
        ))}
      </View>
      {links.length > 0 ? (
        <View className="flex-row flex-wrap gap-x-4 gap-y-1">
          {links.map((link) => (
            <DetailLink
              key={link.url}
              label={link.label}
              url={link.url}
              color={colors.primaryText}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
