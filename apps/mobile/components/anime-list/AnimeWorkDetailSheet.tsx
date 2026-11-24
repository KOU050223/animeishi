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
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
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
import type { WatchState } from "@/lib/watchStatusLabels";
import { alert } from "@/lib/dialog";
import { useAnnictConnection, useAnnictTokenErrorPrompt } from "@/lib/annict";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { AddToWorkListSheet } from "@/components/work-list";
import { buildDanimeWorkSearchUrl } from "@/lib/danime/workSearchUrl";
import {
  DetailLink,
  SectionTitle,
  WorkDetailHeader,
  WorkDetailInfo,
} from "./WorkDetailInfo";
import {
  annictWorkUrl,
  seasonListHref,
  workMediaLabel,
} from "./workDetailFormat";
import type { WorkDetailSheetTarget } from "./workDetailFormat";
import { useAnimeListPalette } from "./animeListStyles";

const WATCH_STATUSES = Object.keys(WATCH_STATUS_LABELS) as WatchState[];

/** 保存操作の結果表示に使う状態。 */
type SaveFeedbackState = "saving" | "saved" | "error";

// 3 段階評価の選択肢（issue #416）。表示順はイマイチ→良い→最高。
const WORK_RATINGS: WorkRating[] = ["bad", "good", "great"];

function normalizeState(state: string | null | undefined): WatchState | null {
  return state && state in WATCH_STATUS_LABELS ? (state as WatchState) : null;
}

export type { WorkDetailSheetTarget } from "./workDetailFormat";

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
  const router = useRouter();
  const { userId } = useAuth();
  const { height } = useWindowDimensions();
  const palette = useAnimeListPalette();
  const colors = useThemeColors();
  const { t } = useTranslation();
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
  const [listTarget, setListTarget] = useState<WorkDetailSheetTarget | null>(
    null,
  );
  const pendingListTarget = useRef<WorkDetailSheetTarget | null>(null);
  // 閉じる要求の直後に別の作品で開き直した場合、閉じ切り通知が来ない
  // （onClosed の遅延タイマーが解除される）ので保留中の追加要求は捨てる。
  // 残したままだと次に閉じたときに古い作品の追加シートが不意に開く。
  useEffect(() => {
    if (work != null) pendingListTarget.current = null;
  }, [work]);
  const [statusFeedback, setStatusFeedback] = useState<{
    workId: number;
    session: number;
    state: SaveFeedbackState;
  } | null>(null);
  const [statusSession, setStatusSession] = useState({
    workId: work?.annictWorkId ?? null,
    revision: 0,
  });
  if (statusSession.workId !== (work?.annictWorkId ?? null)) {
    setStatusSession({
      workId: work?.annictWorkId ?? null,
      revision: statusSession.revision + 1,
    });
  }
  // 保存が連続して始まりうる（チップ連打・記録完了による自動更新）。
  // 先行する操作の完了・失敗が後続の操作の「保存中」表示を上書きしないよう、
  // 結果表示を更新してよいのは最後に開始した操作だけという判定に使う。
  const statusSaveSeq = useRef(0);
  const serverState = normalizeState(detail.data?.work?.state);
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
    const workId = work.annictWorkId;
    const session = statusSession.revision;
    const op = ++statusSaveSeq.current;
    setStatusFeedback({ workId, session, state: "saving" });
    setOptimistic({ workId: work.annictWorkId, state: next });
    const request =
      next === null
        ? remove.mutateAsync(work.annictWorkId)
        : upsert.mutateAsync({
            annictWorkId: work.annictWorkId,
            data: { state: next },
          });
    void request
      .then(() => {
        if (statusSaveSeq.current === op) {
          setStatusFeedback({ workId, session, state: "saved" });
        }
      })
      .catch((e: unknown) => {
        if (statusSaveSeq.current === op) {
          setStatusFeedback({ workId, session, state: "error" });
          // 楽観値を下ろしてサーバー値に戻す。ロールバックできたかで
          // 「元の状態に戻しました」と言えるかが変わる（視聴履歴と同じ扱い）。
          setOptimistic(null);
        }
        // Annict トークン未登録・失効は再連携ダイアログに変換するため、
        // 汎用の失敗通知は出さない（issue #423）。
        if (promptAnnictTokenError(e)) return;
        const rolledBack = (e as UpsertWatchHistoryError).rolledBack === true;
        alert(
          t("更新できませんでした"),
          rolledBack
            ? t("視聴ステータスを更新できませんでした。元の状態に戻しました。")
            : t("一部の更新に失敗しました。"),
          { okLabel: t("OK") },
        );
      })
      .finally(() => {
        // viewerStatusState 由来の state を取り直してから楽観値を下ろす。
        // 成功後も残したままだと、シートを開き直したとき古い選択値が
        // 新しいサーバー値を覆ってしまう（issue #347 レビュー指摘）。
        // 後続の操作が始まっている場合、その楽観値までは下ろさない。
        void queryClient
          .invalidateQueries({ queryKey: detailQueryKey })
          .then(() => {
            if (statusSaveSeq.current === op) setOptimistic(null);
          });
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

  // 放送シーズンのチップから、そのシーズン / 年通年の作品一覧
  // （ライブラリタブのアニメ一覧の絞り込み）へ移る（issue #535）。
  // どの画面のシートからでも同じ導線にするため遷移はシート側が持つ。
  function openSeasonList(seasonParam: string) {
    // 先に閉じないと一覧へ移ったあともシートが残る（上の Tier 表と同じ理由）。
    onClose();
    router.push(seasonListHref(seasonParam));
  }

  function openWorkPage() {
    if (!work) return;
    // 先に閉じないと作品ページから戻ったとき一覧の上にシートが残る
    // （上の Tier 表と同じ理由）。
    onClose();
    router.push({
      pathname: "/work/[id]",
      params: { id: String(work.annictWorkId) },
    });
  }

  const detailWork = detail.data?.work;
  const mediaLabel = workMediaLabel(detailWork?.media, t);

  return (
    <>
      <BottomSheet
        visible={work != null}
        onClose={onClose}
        onClosed={() => {
          if (pendingListTarget.current) {
            setListTarget(pendingListTarget.current);
            pendingListTarget.current = null;
          }
        }}
        scrimAccessibilityLabel={t("背景をタップして作品詳細を閉じる")}
        closeButtonAccessibilityLabel={t("作品詳細を閉じる")}
        testID="anime-work-detail-sheet"
        snapPoints={[{ fraction: 0.8 }, "full"]}
      >
        {work ? (
          <ScrollView style={{ maxHeight: height * 0.8 }}>
            <View className="px-6 pt-6 pb-10 gap-5">
              <WorkDetailHeader
                work={work}
                mediaLabel={mediaLabel}
                onOpenSeasonList={openSeasonList}
              />
              {!work.annictWorkId ? null : userId == null ? (
                // 未ログイン（公開プロフィールの閲覧者）は作品ページも詳細情報も
                // 開けない（AuthGuard と useWorkDetail がサインインを要求する）ため、
                // 作品を追える唯一の導線として Annict リンクを出す。
                <DetailLink
                  label={t("Annict で見る")}
                  url={annictWorkUrl(work.annictWorkId)}
                  color={colors.primaryText}
                />
              ) : (
                <TouchableOpacity
                  className="flex-row items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-3"
                  onPress={openWorkPage}
                  accessibilityRole="link"
                  accessibilityLabel={t("{{title}}の作品ページを見る", {
                    title: work.title,
                  })}
                  testID="work-detail-open-page"
                >
                  <Text className="text-sm font-semibold text-white">
                    {t("作品ページを見る")}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#ffffff" />
                </TouchableOpacity>
              )}
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
                  feedback={
                    statusFeedback?.workId === work.annictWorkId &&
                    statusFeedback.session === statusSession.revision
                      ? statusFeedback.state
                      : null
                  }
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
                  isWatched={currentState === "WATCHED"}
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
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 items-center rounded-lg bg-indigo-50 py-2.5 dark:bg-indigo-950"
                  onPress={() => {
                    pendingListTarget.current = work;
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("{{title}}をリストに追加", {
                    title: work.title,
                  })}
                  testID="work-detail-add-to-list"
                >
                  <Text className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                    {t("リストに追加")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 items-center rounded-lg bg-indigo-50 py-2.5 dark:bg-indigo-950"
                  onPress={() =>
                    void Linking.openURL(buildDanimeWorkSearchUrl(work.title))
                  }
                  accessibilityRole="link"
                  accessibilityLabel={t("{{title}}をdアニメストアで検索", {
                    title: work.title,
                  })}
                  testID="work-detail-danime-search"
                >
                  <Text className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                    {t("dアニメストアで検索")}
                  </Text>
                </TouchableOpacity>
              </View>
              <WorkDetailInfo detail={detail} />
            </View>
          </ScrollView>
        ) : null}
      </BottomSheet>
      {listTarget ? (
        <AddToWorkListSheet
          work={{
            annictWorkId: listTarget.annictWorkId,
            title: listTarget.title,
          }}
          onClose={() => setListTarget(null)}
        />
      ) : null}
    </>
  );
}

/** 保存操作の進捗・結果の表示。3 つの操作欄で共有する。 */
function SaveFeedbackText({
  state,
  testID,
  className,
}: {
  state: SaveFeedbackState;
  testID: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Text
      accessibilityLiveRegion="polite"
      testID={testID}
      // nativewind の className は省略可能プロパティなので、未指定時は
      // キーごと渡さない（exactOptionalPropertyTypes 対応）。
      {...(className !== undefined ? { className } : {})}
    >
      {t(
        state === "saving"
          ? "保存中…"
          : state === "saved"
            ? "保存しました"
            : "保存できませんでした",
      )}
    </Text>
  );
}

/** 「視聴ステータス」見出しの枠。チップ・ゲート・読み込みの各表示で共有する。 */
function StatusSectionFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <View>
      <SectionTitle>{t("視聴ステータス")}</SectionTitle>
      {children}
    </View>
  );
}

/** 視聴ステータス変更チップ（タップで即反映、選択中の再タップで解除）。 */
function StatusSection({
  currentState,
  disabled,
  onSelect,
  feedback,
}: {
  currentState: WatchState | null;
  disabled: boolean;
  onSelect: (state: WatchState) => void;
  feedback: SaveFeedbackState | null;
}) {
  const { t } = useTranslation();
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
              accessibilityLabel={t("視聴ステータスを{{state}}にする", {
                state: t(WATCH_STATUS_LABELS[s]),
              })}
              testID={`work-detail-status-${s}`}
            >
              <Text
                className={`text-xs font-medium ${
                  currentState === s
                    ? "text-indigo-600 dark:text-indigo-300"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {t(WATCH_STATUS_LABELS[s])}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      {feedback ? (
        <SaveFeedbackText
          state={feedback}
          testID="status-save-feedback"
          className="mt-2 text-xs text-slate-500 dark:text-slate-400"
        />
      ) : null}
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
  const { t } = useTranslation();
  const ratingQuery = useWorkRating(work.annictWorkId);
  const upsert = useUpsertWorkRating(work.annictWorkId);
  const remove = useDeleteWorkRating(work.annictWorkId);
  const isMutating = upsert.isPending || remove.isPending;
  const [feedback, setFeedback] = useState<{
    workId: number;
    state: SaveFeedbackState;
  } | null>(null);
  // 結果表示を更新してよいのは最後の保存操作だけ（親の statusSaveSeq と同じ判定）。
  const ratingSaveSeq = useRef(0);
  // 別作品に切り替わったら前の作品の保存結果は破棄する。A→B→A と戻った
  // ときも再表示させない（親の statusSession と同じ派生 state リセット）。
  if (feedback != null && feedback.workId !== work.annictWorkId) {
    setFeedback(null);
  }

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
    const workId = work.annictWorkId;
    const op = ++ratingSaveSeq.current;
    setFeedback({ workId, state: "saving" });
    const request =
      next === null
        ? remove.mutateAsync()
        : upsert.mutateAsync({ rating: next });
    void request
      .then(() => {
        if (ratingSaveSeq.current === op)
          setFeedback({ workId, state: "saved" });
      })
      .catch((e: unknown) => {
        if (ratingSaveSeq.current === op) {
          setFeedback({ workId, state: "error" });
          // 楽観値を下ろしてサーバー値に戻す（ステータス変更と同じ扱い）。
          setOptimistic(null);
        }
        const rolledBack = (e as WorkRatingError).rolledBack === true;
        alert(
          t("更新できませんでした"),
          rolledBack
            ? t("評価を更新できませんでした。元の状態に戻しました。")
            : t("一部の更新に失敗しました。"),
          { okLabel: t("OK") },
        );
      });
  }

  // 視聴済みでなく保存済み評価も無い作品はセクション自体を出さない
  // （読み込み中・取得失敗も同様に畳む。Annict 初期値だけの候補は
  // 「評価がある」には含めない）。
  if (!visible) return null;

  return (
    <View>
      <SectionTitle>{t("この作品の評価")}</SectionTitle>
      {feedback?.workId === work.annictWorkId ? (
        <SaveFeedbackText
          state={feedback.state}
          testID="work-rating-save-feedback"
          className="mb-2 text-xs text-slate-500 dark:text-slate-400"
        />
      ) : null}
      {showHint ? (
        <Text className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          {t("評価するとおすすめの精度が上がります")}
        </Text>
      ) : null}
      {ratingQuery.isLoading ? (
        <View className="items-center py-4">
          <ActivityIndicator size="small" color={palette.spinner} />
        </View>
      ) : ratingQuery.isError ? (
        <View className="items-center py-2 gap-2">
          <Text className="text-xs text-slate-400 dark:text-slate-500">
            {t("評価を取得できませんでした")}
          </Text>
          <TouchableOpacity
            onPress={() => ratingQuery.refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("評価を再取得")}
            testID="work-rating-retry"
          >
            <Text className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              {t("再試行")}
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
              accessibilityLabel={t("この作品を{{rating}}と評価する", {
                rating: t(WORK_RATING_LABELS[r]),
              })}
              testID={`work-detail-rating-${r}`}
            >
              <Text
                className={`text-xs font-medium ${
                  displayedRating === r
                    ? "text-indigo-600 dark:text-indigo-300"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {t(WORK_RATING_LABELS[r])}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * 話数の記録・解除の保存処理と結果表示。記録の直列実行中にシートが別作品へ
 * 切り替わり得るため、完了通知には記録開始時の作品 ID を添える
 * （issue #467 の自動更新は親側で作品が一致するときだけ反映する）。
 */
function useEpisodeRecording({
  workId,
  episodes,
  onTokenError,
  onEpisodesRecorded,
}: {
  workId: number;
  episodes: WorkEpisode[];
  onTokenError: (error: unknown) => boolean;
  onEpisodesRecorded: (annictWorkId: number, allWatched: boolean) => void;
}) {
  const { t } = useTranslation();
  const record = useRecordEpisode(workId);
  const unrecord = useUnrecordEpisode(workId);
  const [feedback, setFeedback] = useState<{
    workId: number;
    state: SaveFeedbackState;
  } | null>(null);
  // 結果表示を更新してよいのは最後の保存操作だけ（親の statusSaveSeq と同じ判定）。
  const saveSeq = useRef(0);
  // 別作品に切り替わったら前の作品の保存結果は破棄する（評価セクションと同じ）。
  if (feedback != null && feedback.workId !== workId) {
    setFeedback(null);
  }

  function notifyRecordError(op: number, e: unknown) {
    if (saveSeq.current === op) {
      setFeedback({ workId, state: "error" });
    }
    // Annict トークン未登録・失効は再連携ダイアログに変換するため、
    // 汎用の失敗通知は出さない（ステータス変更と同じ扱い）。
    if (onTokenError(e)) return;
    const rolledBack = (e as EpisodeRecordError).rolledBack === true;
    alert(
      t("更新できませんでした"),
      rolledBack
        ? t("話の記録を更新できませんでした。元の状態に戻しました。")
        : t("一部の更新に失敗しました。"),
      { okLabel: t("OK") },
    );
  }

  // N 話のチェックは、それ以前の未記録分を含めて記録する。API に一括記録は
  // 無いため、直列化済み（EPISODE_RECORD_WRITE_SCOPE）の既存 mutation を
  // 対象話分だけ順に投げる。リクエストは 1 件ずつ処理されるため Annict の
  // レート制限を突きにくく、話ごとの楽観更新・巻き戻しもそのまま効く。
  async function recordThrough(op: number, episode: WorkEpisode) {
    const targets = episodes.filter(
      (e) => !e.watched && e.sortNumber <= episode.sortNumber,
    );
    const results = await Promise.allSettled(
      targets.map((e) => record.mutateAsync(e.annictEpisodeId)),
    );
    const recorded = new Set(
      targets
        .filter((_, i) => results[i]?.status === "fulfilled")
        .map((e) => e.annictEpisodeId),
    );
    // 1 話も記録できなかった場合はステータスを進めない。
    if (recorded.size > 0) {
      onEpisodesRecorded(
        workId,
        episodes.every((e) => e.watched || recorded.has(e.annictEpisodeId)),
      );
    }
    // 複数話のうち失敗があっても通知は 1 件だけ出す。巻き戻し自体は
    // 各 mutation の onError が話単位で済ませている。
    const firstError = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    )?.reason;
    if (firstError) notifyRecordError(op, firstError);
    else if (saveSeq.current === op) {
      setFeedback({ workId, state: "saved" });
    }
  }

  function toggleEpisode(episode: WorkEpisode) {
    const op = ++saveSeq.current;
    setFeedback({ workId, state: "saving" });
    trackEvent("episode_record", {
      [TRACK_EVENT_KEYS.action]: episode.watched ? "unrecord" : "record",
    });
    if (episode.watched) {
      void unrecord
        .mutateAsync(episode.annictEpisodeId)
        .then(() => {
          if (saveSeq.current === op) {
            setFeedback({ workId, state: "saved" });
          }
        })
        .catch((e: unknown) => notifyRecordError(op, e));
      return;
    }
    void recordThrough(op, episode);
  }

  return {
    feedback,
    isMutating: record.isPending || unrecord.isPending,
    toggleEpisode,
  };
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
 * （issue #467）に使われる。
 */
function EpisodeSection({
  work,
  isWatched,
  onTokenError,
  onEpisodesRecorded,
}: {
  work: WorkDetailSheetTarget;
  isWatched: boolean;
  onTokenError: (error: unknown) => boolean;
  onEpisodesRecorded: (annictWorkId: number, allWatched: boolean) => void;
}) {
  const palette = useAnimeListPalette();
  const { t } = useTranslation();
  const episodesQuery = useWorkEpisodes(work.annictWorkId);
  const episodes = [...(episodesQuery.data?.episodes ?? [])].sort(
    (a, b) => a.sortNumber - b.sortNumber,
  );
  const { feedback, isMutating, toggleEpisode } = useEpisodeRecording({
    workId: work.annictWorkId,
    episodes,
    onTokenError,
    onEpisodesRecorded,
  });

  if (episodesQuery.isLoading) {
    return (
      <View className="items-center py-4">
        <ActivityIndicator size="small" color={palette.spinner} />
      </View>
    );
  }
  if (episodesQuery.isError) {
    return <EpisodeSectionError onRetry={() => episodesQuery.refetch()} />;
  }
  if (episodes.length === 0) return null;

  // 「次の話」= 未視聴の先頭の話。全話記録済みならボタンを無効表示にする。
  const nextEpisode = episodes.find((e) => !e.watched);

  return (
    <View>
      <SectionTitle>{t("話数")}</SectionTitle>
      {isWatched && nextEpisode != null ? (
        <Text className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          {t("視聴ステータスと話数の記録は別です。未記録の話を記録できます。")}
        </Text>
      ) : null}
      {feedback?.workId === work.annictWorkId ? (
        <SaveFeedbackText
          state={feedback.state}
          testID="episode-save-feedback"
          className="mb-2 text-xs text-slate-500 dark:text-slate-400"
        />
      ) : null}
      <EpisodeNextRecordButton
        nextEpisode={nextEpisode}
        isMutating={isMutating}
        isWatched={isWatched}
        onRecord={toggleEpisode}
      />
      <View className="gap-1">
        {episodes.map((episode) => (
          <EpisodeCheckRow
            key={episode.annictEpisodeId}
            episode={episode}
            disabled={isMutating}
            onToggle={toggleEpisode}
          />
        ))}
      </View>
    </View>
  );
}

/** 話数一覧の取得失敗表示。 */
function EpisodeSectionError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View>
      <SectionTitle>{t("話数")}</SectionTitle>
      <View className="items-center py-2 gap-2">
        <Text className="text-xs text-slate-400 dark:text-slate-500">
          {t("話数情報を取得できませんでした")}
        </Text>
        <TouchableOpacity
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t("話数情報を再取得")}
          testID="episode-list-retry"
        >
          <Text className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            {t("再試行")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** 「次の話を記録」ボタン。全話記録済みなら無効表示にする。 */
function EpisodeNextRecordButton({
  nextEpisode,
  isMutating,
  isWatched,
  onRecord,
}: {
  nextEpisode: WorkEpisode | undefined;
  isMutating: boolean;
  isWatched: boolean;
  onRecord: (episode: WorkEpisode) => void;
}) {
  const { t } = useTranslation();
  const active = nextEpisode != null && !isMutating;
  return (
    <TouchableOpacity
      className={`mb-3 items-center rounded-lg py-2.5 ${
        active
          ? "bg-indigo-600 dark:bg-indigo-500"
          : "bg-slate-200 dark:bg-slate-700"
      }`}
      onPress={() => nextEpisode && onRecord(nextEpisode)}
      disabled={!active}
      accessibilityRole="button"
      accessibilityLabel={
        nextEpisode
          ? t("{{episode}}を視聴済みにする", {
              episode: episodeLabel(nextEpisode, t),
            })
          : t("全話記録済み")
      }
      testID="episode-record-next"
    >
      <Text
        className={`text-xs font-semibold ${
          active ? "text-white" : "text-slate-500 dark:text-slate-400"
        }`}
      >
        {nextEpisode
          ? isWatched
            ? t("{{episode}}の視聴を記録", {
                episode: episodeLabel(nextEpisode, t),
              })
            : t("{{episode}}を記録", {
                episode: episodeLabel(nextEpisode, t),
              })
          : t("全話記録済み")}
      </Text>
    </TouchableOpacity>
  );
}

/** 話ごとの視聴記録チェック行。タップした話だけ記録・解除する。 */
function EpisodeCheckRow({
  episode,
  disabled,
  onToggle,
}: {
  episode: WorkEpisode;
  disabled: boolean;
  onToggle: (episode: WorkEpisode) => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      className="flex-row items-center gap-2.5 py-1.5"
      onPress={() => onToggle(episode)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: episode.watched, disabled }}
      accessibilityLabel={t("{{episode}}の視聴記録", {
        episode: episodeLabel(episode, t),
      })}
      testID={`episode-check-${episode.annictEpisodeId}`}
    >
      <Ionicons
        name={episode.watched ? "checkbox" : "square-outline"}
        size={18}
        color={episode.watched ? colors.primaryText : colors.textMuted}
      />
      <View className="flex-1 min-w-0 flex-row items-baseline gap-2">
        <Text
          className={`text-xs font-medium ${
            episode.watched
              ? "text-slate-700 dark:text-slate-200"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {episodeLabel(episode, t)}
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
  const { t } = useTranslation();
  const palette = useAnimeListPalette();

  return (
    <View className="flex-row items-center gap-3">
      <TouchableOpacity
        className="flex-1 flex-row items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2.5 dark:border-slate-600 dark:bg-slate-800"
        onPress={onToggleFavorite}
        disabled={isTogglingFavorite}
        accessibilityRole="button"
        accessibilityLabel={
          isFavorite
            ? t("{{title}}を推しから解除", { title })
            : t("{{title}}を推しに登録", { title })
        }
        testID="work-detail-favorite"
      >
        <Ionicons
          name={isFavorite ? "heart" : "heart-outline"}
          size={16}
          color={isFavorite ? palette.favoriteIconActive : palette.favoriteIcon}
        />
        <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          {isFavorite ? t("推し登録を解除") : t("推しに登録")}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        className="flex-1 items-center rounded-lg bg-indigo-50 py-2.5 dark:bg-indigo-950"
        onPress={onOpenCharacterTierList}
        accessibilityRole="button"
        accessibilityLabel={t("{{title}} のキャラクター Tier 表を作る", {
          title,
        })}
        testID="work-detail-character-tier-list"
      >
        <Text className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
          {t("キャラ Tier 表を作る")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
