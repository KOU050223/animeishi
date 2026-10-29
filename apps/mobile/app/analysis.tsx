import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAnalysis, useGenerateAnalysis } from "@/lib/useAnalysis";
import {
  useGenerateRecommendations,
  useRecommendations,
  type RecommendedWork,
} from "@/lib/useRecommendations";
import { useUpsertWatchHistory, useWatchHistory } from "@/lib/useWatchHistory";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";
import { ApiRequestError } from "@/lib/apiError";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { useThemeColors } from "@/lib/theme";
import { BackButton } from "@/components/ui";
import {
  AnimeWorkDetailSheet,
  type WorkDetailSheetTarget,
} from "@/components/anime-list";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { formatWorkSeason } from "@/components/anime-list/animeListUtils";
import { alert } from "@/lib/dialog";

// generatedAt（ISO 8601）の表示用。Hermes の Intl 実装差を避けるため
// toLocaleString ではなく手動で整形する。
function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// AI 視聴傾向分析（issue #22）。プロフィール画面から遷移する非タブ画面。
// - GET /me/analysis で保存済み結果を表示
// - 「分析する / 再分析する」で POST /me/analysis（API 側で 24h キャッシュ・
//   ユーザーあたりの生成回数制限あり）
export default function AnalysisScreen() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useAnalysis();
  const generate = useGenerateAnalysis();

  const analysis = data?.analysis ?? null;

  // changelog と同じ規約。直リンクでは遷移履歴が無いためホームへ戻す。
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  // 「分析する / 再分析する」の押下を計測する（issue #214）。
  // 結果があるかで初回・再実行を分ける。
  const onGenerate = (runType: "initial" | "regenerate") => {
    trackEvent("analysis_generate", { [TRACK_EVENT_KEYS.runType]: runType });
    generate.mutate();
  };

  const generateErrorMessage =
    generate.error instanceof ApiRequestError
      ? generate.error.message
      : generate.isError
        ? t("分析に失敗しました。時間をおいて再度お試しください")
        : null;

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["top", "bottom"]}
      >
        <BackButton
          onPress={handleBack}
          className="ml-2 self-start"
          accessibilityLabel={t("戻る")}
          testID="analysis-back-button"
        />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-4 text-center text-red-500 dark:text-red-400">
            {t("分析結果の取得に失敗しました")}
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-6 py-3"
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("分析結果を再取得")}
          >
            <Text className="font-semibold text-white">
              {t("もう一度試す")}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <ScrollView contentContainerClassName="px-4 pb-12">
        <BackButton
          onPress={handleBack}
          className="-ml-2 self-start"
          accessibilityLabel={t("戻る")}
          testID="analysis-back-button"
        />
        <View className="pb-3">
          <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
            {t("AI 視聴傾向分析")}
          </Text>
          <Text className="mt-1 text-xs text-gray-400 dark:text-slate-500">
            {t(
              "あなたの視聴履歴をもとに、AI が視聴傾向とおすすめジャンルを分析します",
            )}
          </Text>
        </View>

        {analysis === null ? (
          <View className="items-center justify-center py-16">
            <Text className="mb-6 text-center text-gray-400 dark:text-slate-500">
              {t("まだ分析結果がありません")}
            </Text>
            <GenerateButton
              label={t("分析する")}
              pendingLabel={t("分析中...")}
              isPending={generate.isPending}
              onPress={() => onGenerate("initial")}
              colors={colors}
            />
          </View>
        ) : (
          <View>
            <View className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <Text className="mb-2 text-sm font-semibold text-gray-700 dark:text-slate-200">
                {t("視聴傾向")}
              </Text>
              <Text className="text-base leading-6 text-gray-900 dark:text-slate-100">
                {analysis.summary}
              </Text>

              {analysis.recommendedGenres.length > 0 ? (
                <View className="mt-4">
                  <Text className="mb-2 text-sm font-semibold text-gray-700 dark:text-slate-200">
                    {t("おすすめジャンル")}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {analysis.recommendedGenres.map((genre) => (
                      <View
                        key={genre}
                        className="bg-purple-100 dark:bg-purple-900 rounded-full px-3 py-1"
                      >
                        <Text className="text-purple-700 dark:text-purple-300 text-sm">
                          {genre}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>

            <Text className="mt-3 text-xs text-gray-400 dark:text-slate-500">
              {t("{{count}} 件の視聴履歴を分析", { count: analysis.workCount })}
            </Text>
            <Text className="text-xs text-gray-400 dark:text-slate-500">
              {t("分析日時: {{date}}", {
                date: formatGeneratedAt(analysis.generatedAt),
              })}
            </Text>

            <View className="mt-4">
              <GenerateButton
                label={t("再分析する")}
                pendingLabel={t("分析中...")}
                isPending={generate.isPending}
                onPress={() => onGenerate("regenerate")}
                colors={colors}
              />
              <Text className="mt-2 text-xs text-gray-400 dark:text-slate-500">
                {t(
                  "視聴履歴が変わると次回の実行で結果が更新されます（1 日あたりの実行回数に上限があります）",
                )}
              </Text>
            </View>

            <RecommendationsSection />
          </View>
        )}

        {generateErrorMessage ? (
          <View className="mt-4 rounded-lg bg-red-50 dark:bg-red-950 px-4 py-3">
            <Text
              className="text-sm text-red-600 dark:text-red-400"
              accessibilityRole="alert"
            >
              {generateErrorMessage}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// AI おすすめ（issue #335）。分析結果の下に置き、「おすすめを出す」を
// 押したときだけ生成する。再表示は API の保存済み結果を返すだけなので
// AI・Annict への再問い合わせは起きない。
// 各作品の詳細は作品詳細シート（issue #347）で開く。
function RecommendationsSection() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const router = useRouter();
  const {
    data,
    isLoading: isLoadingRecommendations,
    isError: isRecommendationsError,
    refetch: refetchRecommendations,
  } = useRecommendations();
  const generate = useGenerateRecommendations();
  const upsertHistory = useUpsertWatchHistory();
  const { data: watchHistory } = useWatchHistory();
  // 詳細シート（issue #347）の対象作品と、シート内の推し登録に使う状態。
  const [selectedWork, setSelectedWork] = useState<RecommendedWork | null>(
    null,
  );
  const favoriteIds = useFavoriteIds();
  const { toggle: toggleFavorite, isPending: isTogglingFavorite } =
    useToggleFavorite(favoriteIds, {
      onError: (e) =>
        alert(
          t("お気に入りを更新できませんでした"),
          e instanceof ApiRequestError
            ? e.message
            : t("お気に入りの更新に失敗しました"),
          { okLabel: "OK" },
        ),
    });
  // 「見たい」登録が成功した作品。履歴クエリの反映を待たずにボタンを
  // 登録済み表示へ切り替える。
  const [registeredIds, setRegisteredIds] = useState<Set<number>>(
    () => new Set(),
  );

  const recommendations = data?.recommendations ?? null;

  // 生成後に履歴へ追加された作品（WANNA_WATCH 以外の状態も含む）は
  // 既に登録済みとして扱う。履歴クエリは Annict 未連携では無効化される
  // ため、未取得のときは生成時点の除外結果に委ねる。
  const historyIds = new Set((watchHistory ?? []).map((h) => h.annictWorkId));
  const isRegistered = (annictWorkId: number) =>
    registeredIds.has(annictWorkId) || historyIds.has(annictWorkId);

  const onGenerate = (runType: "initial" | "regenerate") => {
    trackEvent("recommendation_generate", {
      [TRACK_EVENT_KEYS.runType]: runType,
    });
    generate.mutate();
  };

  const onWannaWatch = (work: RecommendedWork) => {
    upsertHistory.mutate(
      { annictWorkId: work.annictWorkId, data: { state: "WANNA_WATCH" } },
      {
        onSuccess: () => {
          setRegisteredIds((prev) => new Set(prev).add(work.annictWorkId));
        },
        onError: (error) => {
          alert(
            t("「見たい」の登録に失敗しました"),
            error instanceof ApiRequestError
              ? error.message
              : t("視聴履歴の更新に失敗しました"),
            { okLabel: "OK" },
          );
        },
      },
    );
  };

  // 詳細シートからのキャラクター tier 表導線（一覧と同じ遷移。issue #169）。
  const openCharacterTierList = (work: WorkDetailSheetTarget) => {
    trackEvent("character_tier_open");
    router.push({
      pathname: "/character-tier-list",
      params: { workId: String(work.annictWorkId), workTitle: work.title },
    });
  };

  const errorMessage =
    generate.error instanceof ApiRequestError
      ? generate.error.message
      : generate.isError
        ? t("おすすめの生成に失敗しました。時間をおいて再度お試しください")
        : null;

  // 保存済み結果の取得に失敗したときは「未生成」と区別してエラーと
  // 再試行を出す（Devin Review 指摘。GET が落ちても生成済み作品を
  // 隠さない）。data が残っている場合は表示を優先する。
  if (isRecommendationsError && data === undefined) {
    return (
      <View className="mt-6">
        <Text className="mb-2 text-sm font-semibold text-gray-700 dark:text-slate-200">
          {t("おすすめ作品")}
        </Text>
        <View className="items-center rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <Text className="mb-3 text-center text-sm text-red-500 dark:text-red-400">
            {t("おすすめの取得に失敗しました")}
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-4 py-2"
            onPress={() => refetchRecommendations()}
            accessibilityRole="button"
            accessibilityLabel={t("おすすめを再取得")}
            testID="recommendations-retry-button"
          >
            <Text className="text-sm font-semibold text-white">
              {t("もう一度試す")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View className="mt-6">
      <Text className="mb-2 text-sm font-semibold text-gray-700 dark:text-slate-200">
        {t("おすすめ作品")}
      </Text>

      {isLoadingRecommendations ? (
        <ActivityIndicator className="my-4 self-start" color={colors.primary} />
      ) : null}

      {recommendations && recommendations.works.length > 0 ? (
        <View className="gap-3">
          {recommendations.works.map((work) => (
            <RecommendationCard
              key={work.annictWorkId}
              work={work}
              registered={isRegistered(work.annictWorkId)}
              registerPending={upsertHistory.isPending}
              onWannaWatch={() => onWannaWatch(work)}
              onOpenDetail={() => setSelectedWork(work)}
            />
          ))}
        </View>
      ) : null}
      {recommendations && recommendations.works.length === 0 ? (
        <Text className="mb-3 text-sm text-gray-400 dark:text-slate-500">
          {t("条件に合うおすすめが見つかりませんでした")}
        </Text>
      ) : null}

      <View className={recommendations ? "mt-4" : undefined}>
        <GenerateButton
          label={t("おすすめを出す")}
          pendingLabel={t("おすすめを生成中...")}
          isPending={generate.isPending}
          onPress={() => onGenerate(recommendations ? "regenerate" : "initial")}
          colors={colors}
        />
        <Text className="mt-2 text-xs text-gray-400 dark:text-slate-500">
          {t(
            "視聴履歴に無い作品から今期・過去作を提案します（1 日あたりの実行回数に上限があります）",
          )}
        </Text>
      </View>

      {errorMessage ? (
        <View className="mt-4 rounded-lg bg-red-50 dark:bg-red-950 px-4 py-3">
          <Text
            className="text-sm text-red-600 dark:text-red-400"
            accessibilityRole="alert"
          >
            {errorMessage}
          </Text>
        </View>
      ) : null}

      <AnimeWorkDetailSheet
        work={selectedWork}
        onClose={() => setSelectedWork(null)}
        isFavorite={
          selectedWork != null && favoriteIds.has(selectedWork.annictWorkId)
        }
        isTogglingFavorite={isTogglingFavorite}
        onToggleFavorite={() => {
          if (selectedWork) toggleFavorite(selectedWork.annictWorkId);
        }}
        onOpenCharacterTierList={openCharacterTierList}
      />
    </View>
  );
}

function RecommendationCard({
  work,
  registered,
  registerPending,
  onWannaWatch,
  onOpenDetail,
}: {
  work: RecommendedWork;
  registered: boolean;
  registerPending: boolean;
  onWannaWatch: () => void;
  onOpenDetail: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3"
      testID={`recommendation-item-${work.annictWorkId}`}
    >
      <WorkThumbnail uri={work.hostedImageUrl} />
      <View className="ml-3 flex-1">
        <Text
          className="text-sm font-semibold text-gray-900 dark:text-slate-100"
          numberOfLines={2}
        >
          {work.title}
        </Text>
        {work.seasonYear ? (
          <Text className="mt-0.5 text-xs text-gray-400 dark:text-slate-500">
            {formatWorkSeason(work)}
          </Text>
        ) : null}
        {work.reason ? (
          <Text
            className="mt-1 text-xs text-gray-500 dark:text-slate-400"
            numberOfLines={2}
          >
            {work.reason}
          </Text>
        ) : null}
        <View className="mt-2 flex-row gap-2">
          <TouchableOpacity
            className={
              registered
                ? "rounded-lg bg-gray-300 dark:bg-slate-600 px-3 py-1.5"
                : "rounded-lg bg-indigo-600 px-3 py-1.5"
            }
            onPress={onWannaWatch}
            disabled={registered || registerPending}
            accessibilityRole="button"
            accessibilityLabel={t("{{title}} を見たいに登録", {
              title: work.title,
            })}
            testID={`recommendation-wanna-watch-${work.annictWorkId}`}
          >
            <Text
              className={
                registered
                  ? "text-xs font-semibold text-gray-600 dark:text-slate-300"
                  : "text-xs font-semibold text-white"
              }
            >
              {registered ? t("登録済み") : t("見たい")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-1.5"
            onPress={onOpenDetail}
            accessibilityRole="button"
            accessibilityLabel={t("{{title}} の詳細を開く", {
              title: work.title,
            })}
            testID={`recommendation-detail-${work.annictWorkId}`}
          >
            <Text className="text-xs font-semibold text-gray-700 dark:text-slate-200">
              {t("詳細")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function GenerateButton({
  label,
  pendingLabel,
  isPending,
  onPress,
  colors,
}: {
  label: string;
  pendingLabel: string;
  isPending: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <TouchableOpacity
      className="items-center rounded-lg bg-indigo-600 px-6 py-3"
      onPress={onPress}
      disabled={isPending}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {isPending ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator color={colors.onPrimary} />
          <Text className="font-semibold text-white">{pendingLabel}</Text>
        </View>
      ) : (
        <Text className="font-semibold text-white">{label}</Text>
      )}
    </TouchableOpacity>
  );
}
