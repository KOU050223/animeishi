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
import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useThemeColors } from "@/lib/theme";
import {
  useWorkDetail,
  WORK_DETAIL_QUERY_KEY,
  workDetailQueryKey,
} from "@/lib/useWorkDetail";
import {
  useDeleteWatchHistory,
  useUpsertWatchHistory,
  WATCH_STATUS_LABELS,
} from "@/lib/useWatchHistory";
import type { UpsertWatchHistoryError } from "@/lib/useWatchHistory";
import {
  useRecordEpisode,
  useUnrecordEpisode,
  useWorkEpisodes,
} from "@/lib/useWorkEpisodes";
import type { EpisodeRecordError, WorkEpisode } from "@/lib/useWorkEpisodes";
import type { WorkDetail } from "@/lib/useWorkDetail";
import type { WatchState } from "@/lib/watchStatusLabels";
import { alert } from "@/lib/dialog";
import { useAnnictConnection, useAnnictTokenErrorPrompt } from "@/lib/annict";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
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
 * 詳細シートが必要とする作品メタ。一覧カードの検索結果（AnimeTitle）に
 * 加えて AI おすすめ（RecommendedWork）のような別経路の作品でも開ける
 * よう、シート内で使うフィールドだけを要求する。残りの詳細情報は
 * useWorkDetail が annictWorkId で取り直す。
 */
export type WorkDetailSheetTarget = Pick<
  AnimeTitle,
  | "annictWorkId"
  | "title"
  | "titleEn"
  | "seasonYear"
  | "seasonName"
  | "hostedImageUrl"
>;

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
  work: WorkDetailSheetTarget | null;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isTogglingFavorite: boolean;
  onOpenCharacterTierList: (work: WorkDetailSheetTarget) => void;
}) {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const { height } = useWindowDimensions();
  const palette = useAnimeListPalette();
  const detail = useWorkDetail(work?.annictWorkId ?? null);
  const upsert = useUpsertWatchHistory();
  const remove = useDeleteWatchHistory();
  // 未連携が確定しているときはステータス欄を連携導線に差し替える（issue #423）。
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  // 連携済み判定でもトークン失効なら API が annict_token_required /
  // annict_token_invalid を返す。その場合はその場で再連携できるダイアログを出す。
  const promptAnnictTokenError = useAnnictTokenErrorPrompt("work_detail_sheet");

  // ステータス変更はサーバー応答（viewerStatusState の取り直し）が遅いため、
  // 選択値を楽観表示する。開く作品が変わったら前の楽観値は下ろす
  // （レンダー中の派生 state リセットパターン。effect 同期は避ける）。
  const [optimistic, setOptimistic] = useState<{
    workId: number;
    state: WatchState | null;
  } | null>(null);
  const serverState = normalizeState(detail.data?.work.state);
  const currentState =
    work && optimistic?.workId === work.annictWorkId
      ? optimistic.state
      : serverState;

  const detailQueryKey =
    userId && work
      ? workDetailQueryKey(userId, work.annictWorkId)
      : WORK_DETAIL_QUERY_KEY;

  function selectStatus(state: WatchState) {
    if (!work) return;
    // 選択中のチップの再タップは未設定に戻す（issue #436）。
    // 解除は DELETE /:annictWorkId（Annict に NO_STATE を送り履歴行を消す）。
    const next: WatchState | null = state === currentState ? null : state;
    trackEvent("watch_status_change", {
      [TRACK_EVENT_KEYS.from]: currentState ?? "NO_STATE",
      [TRACK_EVENT_KEYS.to]: next ?? "NO_STATE",
    });
    setOptimistic({ workId: work.annictWorkId, state: next });
    const request =
      next === null
        ? remove.mutateAsync(work.annictWorkId)
        : upsert.mutateAsync({
            annictWorkId: work.annictWorkId,
            data: { state: next },
          });
    void request
      .catch((e: unknown) => {
        // 楽観値を下ろしてサーバー値に戻す。ロールバックできたかで
        // 「元の状態に戻しました」と言えるかが変わる（視聴履歴と同じ扱い）。
        setOptimistic(null);
        // Annict トークン未登録・失効は再連携ダイアログに変換するため、
        // 汎用の失敗通知は出さない（issue #423）。
        if (promptAnnictTokenError(e)) return;
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
        // viewerStatusState 由来の state を取り直してから楽観値を下ろす。
        // 成功後も残したままだと、シートを開き直したとき古い選択値が
        // 新しいサーバー値を覆ってしまう（issue #347 レビュー指摘）。
        void queryClient
          .invalidateQueries({ queryKey: detailQueryKey })
          .then(() => setOptimistic(null));
      });
  }

  function openCharacterTierList() {
    if (!work) return;
    // 先に閉じないと Tier 表から戻ったとき一覧の上にシートが残る
    // （issue #347 レビュー指摘）。
    onClose();
    onOpenCharacterTierList(work);
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
            <HeaderSection work={work} meta={meta} />
            {isConnectionLoading ? (
              // 連携状態が確定するまでチップ/ゲートのどちらも出さない
              // （連携済みユーザーに一瞬ゲートを見せないため。一覧と同じ扱い）。
              <StatusSectionFrame>
                <View className="items-center py-4">
                  <ActivityIndicator size="small" color={palette.spinner} />
                </View>
              </StatusSectionFrame>
            ) : !isConnected ? (
              // 未連携でステータスを選んでも API が必ず失敗するため、
              // チップではなくその場で連携できる導線に差し替える。
              <StatusSectionFrame>
                <AnnictSoftGate
                  variant="compact"
                  description="視聴ステータスの変更には Annict との連携が必要です。連携すると視聴記録を残せます。"
                  surface="work_detail_sheet"
                  testID="work-detail-status-gate"
                />
              </StatusSectionFrame>
            ) : (
              <StatusSection
                currentState={currentState}
                disabled={upsert.isPending || remove.isPending}
                onSelect={selectStatus}
              />
            )}
            {isConnected ? (
              // 話数記録は Annict 連携必須（record の読み書きを API 経由で
              // Annict に行うため。issue #439）。未連携は上の連携導線を使う。
              <EpisodeSection
                work={work}
                onTokenError={promptAnnictTokenError}
              />
            ) : null}
            <ActionRow
              title={work.title}
              isFavorite={isFavorite}
              isTogglingFavorite={isTogglingFavorite}
              onToggleFavorite={onToggleFavorite}
              onOpenCharacterTierList={openCharacterTierList}
            />
            {work.annictWorkId ? (
              <AnnictWorkLink annictWorkId={work.annictWorkId} />
            ) : null}
            <DetailFetchSection detail={detail} />
          </View>
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

/** ポスター・タイトル（日英）・シーズン・メディア種別のヘッダー部。 */
function HeaderSection({
  work,
  meta,
}: {
  work: WorkDetailSheetTarget;
  meta: string;
}) {
  return (
    <View className="flex-row gap-4">
      <AnimePoster uri={work.hostedImageUrl} title={work.title} />
      <View className="flex-1 min-w-0 justify-center">
        <Text
          className="text-lg font-bold text-slate-900 dark:text-slate-100"
          numberOfLines={3}
        >
          {work.title}
        </Text>
        {work.titleEn ? (
          <Text
            className="mt-1 text-xs text-slate-500 dark:text-slate-400"
            numberOfLines={2}
          >
            {work.titleEn}
          </Text>
        ) : null}
        {meta ? (
          <Text className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {meta}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** 「視聴ステータス」見出しの枠。チップ・ゲート・読み込みの各表示で共有する。 */
function StatusSectionFrame({ children }: { children: React.ReactNode }) {
  return (
    <View>
      <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
        視聴ステータス
      </Text>
      {children}
    </View>
  );
}

/** 視聴ステータス変更チップ（タップで即反映、選択中の再タップで解除）。 */
function StatusSection({
  currentState,
  disabled,
  onSelect,
}: {
  currentState: WatchState | null;
  disabled: boolean;
  onSelect: (state: WatchState) => void;
}) {
  return (
    <StatusSectionFrame>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {WATCH_STATUSES.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => onSelect(s)}
              disabled={disabled}
              className={`px-3 py-2 rounded-full border ${
                currentState === s
                  ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                  : "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
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
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {WATCH_STATUS_LABELS[s]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </StatusSectionFrame>
  );
}

// 話の表示名。「第3話」の numberText を優先し、無ければ話数・
// sortNumber から組み立てる（番外編など numberText/number が無い話向け）。
function episodeLabel(episode: WorkEpisode): string {
  if (episode.numberText) return episode.numberText;
  if (episode.number != null) return `第${episode.number}話`;
  return `第${episode.sortNumber}話`;
}

/**
 * 話数のチェック一覧と「次の話を記録」ボタン（issue #439）。
 * チェックの正は Annict の record（watched = viewerDidTrack）で、
 * 一覧の取得時に API が Annict 側の既存記録を D1 の記録ログと合わせる。
 * 話が 1 件も無い作品（話数未定・マスタ未登録）はセクション自体を出さない。
 */
function EpisodeSection({
  work,
  onTokenError,
}: {
  work: WorkDetailSheetTarget;
  onTokenError: (error: unknown) => boolean;
}) {
  const colors = useThemeColors();
  const palette = useAnimeListPalette();
  const episodesQuery = useWorkEpisodes(work.annictWorkId);
  const record = useRecordEpisode(work.annictWorkId);
  const unrecord = useUnrecordEpisode(work.annictWorkId);
  const isMutating = record.isPending || unrecord.isPending;

  function toggleEpisode(episode: WorkEpisode) {
    trackEvent("episode_record", {
      [TRACK_EVENT_KEYS.action]: episode.watched ? "unrecord" : "record",
    });
    const request = episode.watched
      ? unrecord.mutateAsync(episode.annictEpisodeId)
      : record.mutateAsync(episode.annictEpisodeId);
    void request.catch((e: unknown) => {
      // Annict トークン未登録・失効は再連携ダイアログに変換するため、
      // 汎用の失敗通知は出さない（ステータス変更と同じ扱い）。
      if (onTokenError(e)) return;
      const rolledBack = (e as EpisodeRecordError).rolledBack === true;
      alert(
        "更新できませんでした",
        rolledBack
          ? "話の記録を更新できませんでした。元の状態に戻しました。"
          : "一部の更新に失敗しました。",
        { okLabel: "OK" },
      );
    });
  }

  if (episodesQuery.isLoading) {
    return (
      <View className="items-center py-4">
        <ActivityIndicator size="small" color={palette.spinner} />
      </View>
    );
  }
  if (episodesQuery.isError) {
    return (
      <View>
        <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
          話数
        </Text>
        <View className="items-center py-2 gap-2">
          <Text className="text-xs text-slate-400 dark:text-slate-500">
            話数情報を取得できませんでした
          </Text>
          <TouchableOpacity
            onPress={() => episodesQuery.refetch()}
            accessibilityRole="button"
            accessibilityLabel="話数情報を再取得"
            testID="episode-list-retry"
          >
            <Text className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              再試行
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const episodes = [...(episodesQuery.data?.episodes ?? [])].sort(
    (a, b) => a.sortNumber - b.sortNumber,
  );
  if (episodes.length === 0) return null;

  // 「次の話」= 未視聴の先頭の話。全話記録済みならボタンを無効表示にする。
  const nextEpisode = episodes.find((e) => !e.watched);

  return (
    <View>
      <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
        話数
      </Text>
      <TouchableOpacity
        className={`mb-3 items-center rounded-lg py-2.5 ${
          nextEpisode && !isMutating
            ? "bg-indigo-600 dark:bg-indigo-500"
            : "bg-slate-200 dark:bg-slate-700"
        }`}
        onPress={() => nextEpisode && toggleEpisode(nextEpisode)}
        disabled={!nextEpisode || isMutating}
        accessibilityRole="button"
        accessibilityLabel={
          nextEpisode
            ? `${episodeLabel(nextEpisode)}を視聴済みにする`
            : "全話記録済み"
        }
        testID="episode-record-next"
      >
        <Text
          className={`text-xs font-semibold ${
            nextEpisode && !isMutating
              ? "text-white"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {nextEpisode ? `${episodeLabel(nextEpisode)}を記録` : "全話記録済み"}
        </Text>
      </TouchableOpacity>
      <View className="gap-1">
        {episodes.map((episode) => (
          <TouchableOpacity
            key={episode.annictEpisodeId}
            className="flex-row items-center gap-2.5 py-1.5"
            onPress={() => toggleEpisode(episode)}
            disabled={isMutating}
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: episode.watched,
              disabled: isMutating,
            }}
            accessibilityLabel={`${episodeLabel(episode)}の視聴記録`}
            testID={`episode-check-${episode.annictEpisodeId}`}
          >
            <Ionicons
              name={episode.watched ? "checkbox" : "square-outline"}
              size={18}
              color={episode.watched ? colors.primaryText : colors.textFaint}
            />
            <View className="flex-1 min-w-0 flex-row items-baseline gap-2">
              <Text
                className={`text-xs font-medium ${
                  episode.watched
                    ? "text-slate-700 dark:text-slate-200"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {episodeLabel(episode)}
              </Text>
              {episode.title ? (
                <Text
                  className="flex-1 text-xs text-slate-400 dark:text-slate-500"
                  numberOfLines={1}
                >
                  {episode.title}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/** 推し登録とキャラ Tier 表への導線。 */
function ActionRow({
  title,
  isFavorite,
  isTogglingFavorite,
  onToggleFavorite,
  onOpenCharacterTierList,
}: {
  title: string;
  isFavorite: boolean;
  isTogglingFavorite: boolean;
  onToggleFavorite: () => void;
  onOpenCharacterTierList: () => void;
}) {
  const palette = useAnimeListPalette();

  return (
    <View className="flex-row items-center gap-3">
      <TouchableOpacity
        className="flex-1 flex-row items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2.5 dark:border-slate-600 dark:bg-slate-800"
        onPress={onToggleFavorite}
        disabled={isTogglingFavorite}
        accessibilityRole="button"
        accessibilityLabel={
          isFavorite ? `${title}を推しから解除` : `${title}を推しに登録`
        }
        testID="work-detail-favorite"
      >
        <Ionicons
          name={isFavorite ? "heart" : "heart-outline"}
          size={16}
          color={isFavorite ? palette.favoriteIconActive : palette.favoriteIcon}
        />
        <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          {isFavorite ? "推し登録を解除" : "推しに登録"}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        className="flex-1 items-center rounded-lg bg-indigo-50 py-2.5 dark:bg-indigo-950"
        onPress={onOpenCharacterTierList}
        accessibilityRole="button"
        accessibilityLabel={`${title} のキャラクター Tier 表を作る`}
        testID="work-detail-character-tier-list"
      >
        <Text className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
          キャラ Tier 表を作る
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** Annict の詳細情報。読み込み中・失敗はカードの情報だけ表示する。 */
function DetailFetchSection({
  detail,
}: {
  detail: ReturnType<typeof useWorkDetail>;
}) {
  const colors = useThemeColors();

  if (detail.isLoading) {
    return (
      <View className="items-center py-4">
        <ActivityIndicator size="small" color={colors.textFaint} />
      </View>
    );
  }
  if (detail.isError) {
    return (
      <View className="items-center py-2 gap-2">
        <Text className="text-xs text-slate-400 dark:text-slate-500">
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
    );
  }
  if (!detail.data?.work) return null;
  return <WorkDetailSection work={detail.data.work} />;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-xs text-slate-400 dark:text-slate-500">
        {label}
      </Text>
      <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
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

/**
 * Annict の作品ページを開くリンク（issue #372）。links 一覧に入れず
 * 独立して出すのは、詳細取得の失敗・読み込み中でも一覧カードの
 * annictWorkId から URL を組み立てられるため。
 */
function AnnictWorkLink({ annictWorkId }: { annictWorkId: number }) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <DetailLink
      label={t("Annict で見る")}
      url={`https://annict.com/works/${annictWorkId}`}
      color={colors.primaryText}
    />
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
