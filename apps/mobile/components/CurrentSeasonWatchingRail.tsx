import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { CurrentSeasonConnectCard } from "@/components/CurrentSeasonConnectCard";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { currentSeason } from "@/components/anime-list/animeListUtils";
import type { SeasonKey } from "@/components/anime-list/animeListUtils";
import { useAnnictConnection } from "@/lib/annict";
import { filterWatchingBySeason } from "@/lib/currentSeasonWatching";
import { WorkDetailPressable } from "@/components/anime-list/WorkDetailPressable";
import type { TranslationKey } from "@/lib/i18n/keys";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { useWatchHistory } from "@/lib/useWatchHistory";

// シーズンキー → 季節名の i18n キー。SEASONS（アニメ一覧用）は日本語ラベルを
// 直接持つため en で訳せないので、訳語の解決用に別マップを持つ。
const SEASON_I18N_KEYS: Record<SeasonKey, TranslationKey> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

export function CurrentSeasonWatchingRail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  const { data, isLoading, isError, refetch } = useWatchHistory();
  // 初回フォーカスは useQuery の初回取得と重複するため再取得を飛ばす
  const hasFocused = useRef(false);
  // 依存配列に isConnected を入れると、未連携→連携でコールバックが
  // 作り直されて effect が再実行され、enabled 反転で始まったばかりの
  // 初回取得を refetch がキャンセルして二重に投げる。最新値だけ欲しい
  // ので ref 経由にする。
  const isConnectedRef = useRef(isConnected);
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  // タブ切替では画面のマウントが維持され stale のまま残るため、
  // ホームへ戻ったタイミングで再取得して最新の視聴状態を拾う
  // （FriendStoryRail と同じ仕組み）。未連携だとクエリ自体が
  // 無効化されているが refetch は enabled を無視して投げるので、
  // 401 になるだけのリクエストを飛ばさないよう連携時だけに絞る。
  // useFocusEffect はコールバックの参照変化で購読し直すため、useCallback を残す。
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current && isConnectedRef.current) void refetch();
      hasFocused.current = true;
    }, [refetch]),
  );

  // 「今期」の対象範囲（放送開始シーズン）を画面に明記する（issue #598）。
  // 範囲外の視聴中作品（過去シーズンの残存ステータス等）はレールに出ないため、
  // 対象が見えないとライブラリ側の件数と不整合に見える。
  const { year, key } = currentSeason();
  const works = filterWatchingBySeason(data ?? [], `${year}-${key}`);
  const seasonLabel = t("{{year}}年{{season}}", {
    year,
    season: t(SEASON_I18N_KEYS[key]),
  });

  return (
    <View className="mt-6" testID="home-current-season">
      <Text className="mb-1 text-base font-semibold text-foreground">
        {t("今期視聴中")}
      </Text>
      <Text className="mb-2 text-xs text-muted">
        {t("{{season}}アニメのうち「視聴中」", { season: seasonLabel })}
      </Text>
      {isConnectionLoading ? (
        <WatchingRailSkeleton />
      ) : !isConnected ? (
        // 閉じるボタンを付けない: 連携すれば自然に消えるため（#424 の決定）
        <CurrentSeasonConnectCard
          description="Annict と連携すると、ここに今期視聴中の作品が並びます"
          connectLabel="Annict と連携する"
          surface="home_current_season"
        />
      ) : isLoading ? (
        <WatchingRailSkeleton />
      ) : isError ? (
        <View className="flex-row items-center gap-3">
          <Text className="text-sm text-muted">
            {t("視聴履歴を取得できませんでした")}
          </Text>
          <TouchableOpacity
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("視聴履歴を再取得")}
          >
            <Text className="text-sm font-semibold text-primary-text">
              {t("再試行")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : works.length === 0 ? (
        // 空表示では「今期」の範囲外に残っている視聴中作品（過去シーズンの
        // ステータス等）がどこで確認できるかまで示す（issue #598）。
        <View>
          <Text className="text-sm text-muted">
            {t("{{season}}アニメで「視聴中」の作品はありません", {
              season: seasonLabel,
            })}
          </Text>
          <Text className="mt-1 text-xs text-muted">
            {t(
              "過去のシーズンを含むすべての「視聴中」作品はライブラリの視聴履歴で確認できます",
            )}
          </Text>
          <TouchableOpacity
            className="mt-2 self-start"
            onPress={() => router.push("/(tabs)/library?section=history")}
            accessibilityRole="button"
            accessibilityLabel={t("ライブラリの視聴履歴を見る")}
            testID="home-current-season-library-link"
          >
            <Text className="text-sm font-semibold text-primary-text">
              {t("ライブラリの視聴履歴を見る")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          horizontal
          data={works}
          keyExtractor={(work) => String(work.annictWorkId)}
          renderItem={({ item: work }) => (
            <WorkDetailPressable
              work={work}
              className="w-24"
              testID={`home-watching-work-${work.annictWorkId}`}
            >
              <WorkThumbnail
                uri={work.hostedImageUrl}
                title={work.title}
                width={96}
                height={136}
                radius={8}
              />
              <Text className="mt-1 text-xs text-secondary" numberOfLines={2}>
                {work.title}
              </Text>
            </WorkDetailPressable>
          )}
          ItemSeparatorComponent={() => <View className="w-3" />}
          showsHorizontalScrollIndicator={false}
          testID="home-current-season-rail"
        />
      )}
    </View>
  );
}

// 読み込み中は横並びサムネイル（WorkThumbnail 96x136 + タイトル 2 行）と
// 同じ並びの骨を敷く。枚数は幅に収まる先頭の 3 枚分。
function WatchingRailSkeleton() {
  const { t } = useTranslation();
  return (
    <SkeletonGroup
      accessibilityLabel={t("読み込み中")}
      className="flex-row gap-3"
      testID="current-season-skeleton"
    >
      {[0, 1, 2].map((i) => (
        <View key={i} className="w-24">
          <Skeleton className="h-[136px] w-24 rounded-lg" />
          <Skeleton className="mt-1 h-3 w-16 rounded" muted />
        </View>
      ))}
    </SkeletonGroup>
  );
}
