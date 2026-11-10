import { useEffect, useRef, useState } from "react";
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
import { episodeLabel } from "@/lib/episodeLabel";
import {
  useDeleteWorkRating,
  useUpsertWorkRating,
  useWorkRating,
  WORK_RATING_LABELS,
} from "@/lib/useWorkRating";
import type { WorkRating, WorkRatingError } from "@/lib/useWorkRating";
import {
  loadWorkRatingHintSeen,
  markWorkRatingHintSeen,
} from "@/lib/workRatingHint";
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

// 3 段階評価の選択肢（issue #416）。表示順はイマイチ→良い→最高。
const WORK_RATINGS: WorkRating[] = ["bad", "good", "great"];

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

  function applyStatus(next: WatchState | null) {
    if (!work) return;
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

  function selectStatus(state: WatchState) {
    // 選択中のチップの再タップは未設定に戻す（issue #436）。
    // 解除は DELETE /:annictWorkId（Annict に NO_STATE を送り履歴行を消す）。
    const next: WatchState | null = state === currentState ? null : state;
    trackEvent("watch_status_change", {
      [TRACK_EVENT_KEYS.from]: currentState ?? "NO_STATE",
      [TRACK_EVENT_KEYS.to]: next ?? "NO_STATE",
    });
    applyStatus(next);
  }

  // 話数記録による自動ステータス更新（issue #467）で、判定に「発火時点」
  // ではなく「記録が全部 settle した時点」の state を使うための経路。
  // 記録の直列実行中にチップで別ステータスを付けられた場合も、最新値を
  // 見て上書きしない判断ができる（ref の同期は effect で行う）。
  const latestStatus = useRef<{
    workId: number | null;
    stateKnown: boolean;
    state: WatchState | null;
    apply: (next: WatchState | null) => void;
  }>({ workId: null, stateKnown: false, state: null, apply: () => {} });
  useEffect(() => {
    latestStatus.current = {
      workId: work?.annictWorkId ?? null,
      // detail.data が無いときの null は「未設定」ではなく「未取得」を
      // 意味し得るため、明示ステータスの誤上書きを防ぐ判定に分けて持つ。
      stateKnown:
        work != null &&
        (optimistic?.workId === work.annictWorkId || detail.data != null),
      state: currentState,
      apply: applyStatus,
    };
  });

  // 話数の記録が全部終わった時点で呼ばれる。未設定 → 視聴中、全話記録で
  // → 視聴済み。ユーザーが明示的に付けたステータス（視聴予定・一時停止・
  // 断念）は上書きしない（issue #467 の方針決定）。
  function handleEpisodesRecorded(annictWorkId: number, allWatched: boolean) {
    const { workId, stateKnown, state, apply } = latestStatus.current;
    // 記録の直列実行中に別作品へ切り替わった・詳細未取得でステータスを
    // 判定できないケースは自動更新しない。
    if (workId !== annictWorkId || !stateKnown) return;
    if (allWatched) {
      if (state === null || state === "WATCHING") apply("WATCHED");
    } else if (state === null) {
      apply("WATCHING");
    }
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
      snapPoints={[{ fraction: 0.8 }, "full"]}
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
            {
              // 評価は作品への意見なので、視聴状態を戻しても D1 の評価は残す
              // （issue #416）。そのため出し分けは「視聴済み、または既に評価が
              // ある」作品: 視聴中に戻した作品でも評価を外せるようにする。
              // API 側も視聴状態では拒否しない。
              // 視聴済みかの判定が Annict 由来の state に依存するため、未連携
              // では評価済み作品しかセクションは出ない。
              <RatingSection
                work={work}
                isWatched={currentState === "WATCHED"}
              />
            }
            {isConnected ? (
              // 話数記録は Annict 連携必須（record の読み書きを API 経由で
              // Annict に行うため。issue #439）。未連携は上の連携導線を使う。
              <EpisodeSection
                work={work}
                onTokenError={promptAnnictTokenError}
                onEpisodesRecorded={handleEpisodesRecorded}
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

/**
 * 視聴済み作品へのワンタップ 3 段階評価（issue #416）。
 * 表示する選択値は「D1 の評価 → Annict レビュー初期値（annictRating）」の順。
 * Annict 初期値は未保存の候補なので、選択中の再タップでは表示だけ下ろし、
 * D1 に評価がある場合だけ DELETE を送る。
 *
 * 評価は作品への意見なので視聴状態を戻しても残る（API も視聴状態では
 * 拒否しない）。そのためセクション自体は「視聴済み or 保存済み評価あり」
 * で出し、視聴中へ戻した作品でも評価を外せるようにする。
 */
function RatingSection({
  work,
  isWatched,
}: {
  work: WorkDetailSheetTarget;
  isWatched: boolean;
}) {
  const palette = useAnimeListPalette();
  const ratingQuery = useWorkRating(work.annictWorkId);
  const upsert = useUpsertWorkRating(work.annictWorkId);
  const remove = useDeleteWorkRating(work.annictWorkId);
  const isMutating = upsert.isPending || remove.isPending;

  // 解除（未評価）は「Annict 初期値も選ばない」という端末側の状態でしか
  // 表せない（再取得すると annictRating が再び候補として返るため）。
  // ステータスと同じく、開いている作品が変わったら下ろす。
  const [optimistic, setOptimistic] = useState<{
    workId: number;
    rating: WorkRating | null;
  } | null>(null);
  const storedRating = ratingQuery.data?.rating ?? null;
  const visible = isWatched || storedRating != null;

  // 「評価するとおすすめの精度が上がります」は初回だけ出す。
  // 表示済みフラグは端末ローカルでよい（issue #416 の決定）。
  // セクションが非表示の間は読み込まない（見えていないのに
  // 既読扱いにしないため）。
  const [showHint, setShowHint] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    void loadWorkRatingHintSeen().then((seen) => {
      if (seen) return;
      if (mounted) setShowHint(true);
      void markWorkRatingHintSeen();
    });
    return () => {
      mounted = false;
    };
  }, [visible]);
  const displayedRating =
    optimistic?.workId === work.annictWorkId
      ? optimistic.rating
      : (storedRating ?? ratingQuery.data?.annictRating ?? null);

  function selectRating(rating: WorkRating) {
    // 選択中の再タップは解除（ステータスチップと同じ操作感）。
    const next: WorkRating | null = rating === displayedRating ? null : rating;
    trackEvent("work_rating_change", {
      [TRACK_EVENT_KEYS.from]: displayedRating ?? "none",
      [TRACK_EVENT_KEYS.to]: next ?? "none",
    });
    setOptimistic({ workId: work.annictWorkId, rating: next });
    // Annict 初期値の表示を下ろすだけなら、サーバーに消すものが無い。
    if (next === null && storedRating == null) return;
    const request =
      next === null
        ? remove.mutateAsync()
        : upsert.mutateAsync({ rating: next });
    void request.catch((e: unknown) => {
      // 楽観値を下ろしてサーバー値に戻す（ステータス変更と同じ扱い）。
      setOptimistic(null);
      const rolledBack = (e as WorkRatingError).rolledBack === true;
      alert(
        "更新できませんでした",
        rolledBack
          ? "評価を更新できませんでした。元の状態に戻しました。"
          : "一部の更新に失敗しました。",
        { okLabel: "OK" },
      );
    });
  }

  // 視聴済みでなく保存済み評価も無い作品はセクション自体を出さない
  // （読み込み中・取得失敗も同様に畳む。Annict 初期値だけの候補は
  // 「評価がある」には含めない）。
  if (!visible) return null;

  return (
    <View>
      <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
        この作品の評価
      </Text>
      {showHint ? (
        <Text className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          評価するとおすすめの精度が上がります
        </Text>
      ) : null}
      {ratingQuery.isLoading ? (
        <View className="items-center py-4">
          <ActivityIndicator size="small" color={palette.spinner} />
        </View>
      ) : ratingQuery.isError ? (
        <View className="items-center py-2 gap-2">
          <Text className="text-xs text-slate-400 dark:text-slate-500">
            評価を取得できませんでした
          </Text>
          <TouchableOpacity
            onPress={() => ratingQuery.refetch()}
            accessibilityRole="button"
            accessibilityLabel="評価を再取得"
            testID="work-rating-retry"
          >
            <Text className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              再試行
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="flex-row gap-2">
          {WORK_RATINGS.map((r) => (
            <TouchableOpacity
              key={r}
              onPress={() => selectRating(r)}
              disabled={isMutating}
              className={`flex-1 items-center px-3 py-2 rounded-full border ${
                displayedRating === r
                  ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                  : "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
              }`}
              accessibilityRole="button"
              accessibilityState={{ selected: displayedRating === r }}
              accessibilityLabel={`この作品を${WORK_RATING_LABELS[r]}と評価する`}
              testID={`work-detail-rating-${r}`}
            >
              <Text
                className={`text-xs font-medium ${
                  displayedRating === r
                    ? "text-indigo-600 dark:text-indigo-300"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {WORK_RATING_LABELS[r]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * 話数のチェック一覧と「次の話を記録」ボタン（issue #439）。
 * チェックの正は Annict の record（watched = viewerDidTrack）で、
 * 一覧の取得時に API が Annict 側の既存記録を D1 の記録ログと合わせる。
 * 話が 1 件も無い作品（話数未定・マスタ未登録）はセクション自体を出さない。
 *
 * N 話をチェックすると、それより前の未記録分もまとめて記録する（issue #466）。
 * 解除はタップした 1 話だけを外す。記録が全部終わると onEpisodesRecorded で
 * 「全話記録済みになったか」を親へ通知し、視聴ステータスの自動更新
 * （issue #467）に使われる。直列実行中にシートが別作品へ切り替わり得るため、
 * 通知には記録開始時の作品 ID を添える。
 */
function EpisodeSection({
  work,
  onTokenError,
  onEpisodesRecorded,
}: {
  work: WorkDetailSheetTarget;
  onTokenError: (error: unknown) => boolean;
  onEpisodesRecorded: (annictWorkId: number, allWatched: boolean) => void;
}) {
  const colors = useThemeColors();
  const palette = useAnimeListPalette();
  const episodesQuery = useWorkEpisodes(work.annictWorkId);
  const record = useRecordEpisode(work.annictWorkId);
  const unrecord = useUnrecordEpisode(work.annictWorkId);
  const isMutating = record.isPending || unrecord.isPending;
  const episodes = [...(episodesQuery.data?.episodes ?? [])].sort(
    (a, b) => a.sortNumber - b.sortNumber,
  );

  function notifyRecordError(e: unknown) {
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
  }

  // N 話のチェックは、それ以前の未記録分を含めて記録する。API に一括記録は
  // 無いため、直列化済み（EPISODE_RECORD_WRITE_SCOPE）の既存 mutation を
  // 対象話分だけ順に投げる。リクエストは 1 件ずつ処理されるため Annict の
  // レート制限を突きにくく、話ごとの楽観更新・巻き戻しもそのまま効く。
  async function recordThrough(episode: WorkEpisode) {
    const targets = episodes.filter(
      (e) => !e.watched && e.sortNumber <= episode.sortNumber,
    );
    const results = await Promise.allSettled(
      targets.map((e) => record.mutateAsync(e.annictEpisodeId)),
    );
    const recorded = new Set(
      targets
        .filter((_, i) => results[i].status === "fulfilled")
        .map((e) => e.annictEpisodeId),
    );
    // 1 話も記録できなかった場合はステータスを進めない。
    if (recorded.size > 0) {
      onEpisodesRecorded(
        work.annictWorkId,
        episodes.every((e) => e.watched || recorded.has(e.annictEpisodeId)),
      );
    }
    // 複数話のうち失敗があっても通知は 1 件だけ出す。巻き戻し自体は
    // 各 mutation の onError が話単位で済ませている。
    const firstError = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    )?.reason;
    if (firstError) notifyRecordError(firstError);
  }

  function toggleEpisode(episode: WorkEpisode) {
    trackEvent("episode_record", {
      [TRACK_EVENT_KEYS.action]: episode.watched ? "unrecord" : "record",
    });
    if (episode.watched) {
      void unrecord
        .mutateAsync(episode.annictEpisodeId)
        .catch(notifyRecordError);
      return;
    }
    void recordThrough(episode);
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
