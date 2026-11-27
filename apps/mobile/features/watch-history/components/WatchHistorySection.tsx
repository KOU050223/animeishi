import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { selectionAccessibilityProps } from "@/lib/accessibility";
import {
  useWatchHistory,
  useUpsertWatchHistory,
  useDeleteWatchHistory,
  WATCH_STATUS_LABELS,
} from "@/features/watch-history/useWatchHistory";
import type {
  WatchHistoryItem,
  UpsertWatchHistoryError,
} from "@/features/watch-history/useWatchHistory";
import {
  useFavoriteIds,
  useToggleFavorite,
} from "@/features/favorites/useFavorites";
import { ApiRequestError } from "@/lib/apiError";
import { alert, confirm } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { useDanimeImportEnabled } from "@/lib/featureFlags/useDanimeImportEnabled";
import { useAnnictConnection } from "@/features/annict";
import { AnnictSoftGate } from "@/features/annict/components/AnnictSoftGate";
import { WatchHistoryShareSection } from "@/features/watch-history/components/WatchHistoryShareSection";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MenuPicker } from "@/components/ui/menu-picker";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { FavoriteButton } from "@/features/favorites/components/FavoriteButton";
import { AnimeWorkDetailSheet } from "@/features/works/components/AnimeWorkDetailSheet";
import type { WorkDetailSheetTarget } from "@/features/works/components/AnimeWorkDetailSheet";
import {
  AddToWorkListButton,
  AddToWorkListSheet,
} from "@/features/work-lists/components";
import { ListLoadingSkeleton } from "@/components/ui/ListLoadingSkeleton";
import {
  GRID_GAP,
  getRowListGridLayout,
} from "@/components/anime-list/animeListUtils";
import {
  NO_WATCH_HISTORY_FILTERS,
  WATCH_HISTORY_SORT_KEYS,
  WATCH_HISTORY_SORT_LABELS,
  collectWatchHistoryDecades,
  filterWatchHistory,
  isWatchHistoryFilterActive,
  sortWatchHistory,
} from "@/features/watch-history/watchHistorySortFilter";
import type {
  WatchHistoryDecade,
  WatchHistoryFilters,
  WatchHistorySortKey,
} from "@/features/watch-history/watchHistorySortFilter";

const WATCH_STATUSES = [
  "WATCHING",
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
  "WANNA_WATCH",
] as const;

type WatchStatus = (typeof WATCH_STATUSES)[number];

// 失敗通知の種類。キュー上で同じ種類が連続した場合は件数で1件にまとめる。
type FailureKind = "update" | "delete";
type FailureNotice = { kind: FailureKind; title: string; message: string };

// 同種の失敗を1件にまとめたときの件数入り文言。単体通知は各呼び出し側が
// 文言を組み立てるため、まとめた場合だけこの固定文に切り替える。
function mergedFailureMessage(
  kind: FailureKind,
  count: number,
  t: TFunction,
): string {
  return kind === "update"
    ? t("{{count}}件の視聴ステータス更新に失敗しました。", { count })
    : t("{{count}}件の視聴履歴削除に失敗しました", { count });
}

// 「元に戻す」トーストの自動で消えるまでの時間。スナックバー相当の
// 操作猶予として 5 秒取る（短すぎると気づく前に消える）。
const STATUS_TOAST_MS = 5000;

// 失敗通知キューを1件ずつダイアログに流す。コンポーネント内に置くと
// 再帰する関数宣言が React Compiler の最適化を妨げるためモジュール関数にする。
function flushFailureQueue(
  queue: FailureNotice[],
  alertOpenRef: { current: boolean },
  t: TFunction,
): void {
  if (alertOpenRef.current) return;
  const first = queue.shift();
  if (!first) return;
  // 直後に同じ種類が続くなら、件数をまとめて1件の通知にする。
  let count = 1;
  while (queue[0]?.kind === first.kind) {
    queue.shift();
    count += 1;
  }
  alertOpenRef.current = true;
  alert(
    first.title,
    count === 1 ? first.message : mergedFailureMessage(first.kind, count, t),
    {
      okLabel: "OK",
      onClose: () => {
        alertOpenRef.current = false;
        flushFailureQueue(queue, alertOpenRef, t);
      },
    },
  );
}

// pull-to-refresh。refetch が reject しても refreshing を必ず戻す。
// try/finally を含むためコンポーネント内に置くと React Compiler が
// 最適化できず、モジュール関数に切り出す。
async function refreshWatchHistory(
  setRefreshing: (refreshing: boolean) => void,
  refetch: () => Promise<unknown>,
): Promise<void> {
  setRefreshing(true);
  try {
    await refetch();
  } finally {
    setRefreshing(false);
  }
}

// ステータス変更直後に出す「元に戻す」トーストの内容。
// previousState が「押すと直前のステータスに戻す」先。
type StatusUndoToast = {
  annictWorkId: number;
  title: string;
  previousState: WatchStatus;
  /** 変更後ステータスの表示名（トースト本文用。生成時点の言語で翻訳済み）。 */
  toLabel: string;
};

// ライブラリタブの「視聴履歴」セクション（旧視聴履歴タブ）。
// 画面上部の safe area とセクション切り替えはライブラリ画面側が持つため、
// ここではセクション名の見出しを出さず件数と操作だけを表示する。
export function WatchHistorySection() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const danimeImportEnabled = useDanimeImportEnabled();
  const [refreshing, setRefreshing] = useState(false);
  // 「リストに追加」シートの対象作品（issue #379）。
  const [listTarget, setListTarget] = useState<WatchHistoryItem | null>(null);
  const [detailWork, setDetailWork] = useState<WatchHistoryItem | null>(null);
  // 直前のステータス変更を取り消せるトースト。新しい変更で差し替わる。
  const [statusToast, setStatusToast] = useState<StatusUndoToast | null>(null);
  const statusToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sortKey, setSortKey] = useState<WatchHistorySortKey>("updatedAt");
  const [filters, setFilters] = useState<WatchHistoryFilters>(
    NO_WATCH_HISTORY_FILTERS,
  );
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // ステータス更新は楽観的更新のため、失敗時（ロールバック）は必ず
  // ユーザーに伝える。短時間で消えるトーストだと見落とすため、OK を
  // 押すまで消えないダイアログで通知する。表示中に起きた失敗は捨てずに
  // キューへ積み、閉じたあと順に出す。同じ種類が連続する分は件数で
  // 1件にまとめるため、ダイアログが積み上がらず取りこぼしもない。
  const failureQueueRef = useRef<FailureNotice[]>([]);
  const failureAlertOpenRef = useRef(false);
  const flushFailures = () =>
    flushFailureQueue(failureQueueRef.current, failureAlertOpenRef, t);
  const notifyFailure = (kind: FailureKind, title: string, message: string) => {
    failureQueueRef.current.push({ kind, title, message });
    flushFailures();
  };

  // ソフトゲート: 視聴履歴は Annict 連携が前提。未連携のうちは useWatchHistory が
  // クエリを無効化しているため、ここで連携誘導を出して導線を与える。
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  const { data: histories, isLoading, isError, refetch } = useWatchHistory();
  const upsert = useUpsertWatchHistory();
  const remove = useDeleteWatchHistory();
  // Web の広い幅では行一覧を複数列にする（issue #602）。Platform.OS ではなく
  // 幅だけで判定し、狭い幅では従来どおり 1 列の全幅リストにする。
  const { width } = useWindowDimensions();
  const grid = getRowListGridLayout(width);
  const isGrid = grid.numColumns > 1;

  // 各行の「推しに追加」（issue #379）。アニメ一覧と同じフック・ボタンを使う。
  const favoriteIds = useFavoriteIds();
  const { toggle: toggleFavorite, isPending: isTogglingFavorite } =
    useToggleFavorite(favoriteIds, {
      // トグル失敗は画面に変化が残らないため、OK を押すまで消えない
      // ダイアログで必ず伝える（アニメ一覧と同じ方針）。
      onError: (e) =>
        alert(
          t("推しを更新できませんでした"),
          e instanceof ApiRequestError
            ? t(e.message, { defaultValue: e.message })
            : t("推しの更新に失敗しました"),
          { okLabel: t("OK") },
        ),
    });

  useEffect(
    () => () => {
      if (statusToastTimer.current) clearTimeout(statusToastTimer.current);
    },
    [],
  );

  const enriched = histories ?? [];

  // 年代フィルタの選択肢は一覧に出る作品から作る（存在しない年代を出さない）。
  const decades = collectWatchHistoryDecades(enriched);
  const filterActive = isWatchHistoryFilterActive(filters);
  const visible = sortWatchHistory(
    filterWatchHistory(enriched, filters),
    sortKey,
  );

  const onRefresh = () => refreshWatchHistory(setRefreshing, refetch);

  const openCharacterTierList = (work: WorkDetailSheetTarget) => {
    // キャラクター tier 表を開く操作を計測する（issue #214）。
    trackEvent("character_tier_open");
    router.push({
      pathname: "/tier-list",
      params: {
        kind: "character",
        workId: String(work.annictWorkId),
        workTitle: work.title,
      },
    });
  };

  function confirmDelete(annictWorkId: number) {
    confirm(
      t("視聴履歴を削除"),
      t("この視聴履歴を削除しますか？"),
      () => {
        // 呼び出し別コールバック（mutate の第2引数）は連続 mutate で
        // 前の呼び出し分が発火しないため、mutation 個別に reject する
        // mutateAsync の promise で失敗を拾う。
        // ApiRequestError はユーザー向け日本語メッセージを持つ。
        // ネットワーク断等の技術メッセージはそのまま出さず固定文言に寄せる。
        void remove
          .mutateAsync(annictWorkId)
          .catch((e: unknown) =>
            notifyFailure(
              "delete",
              t("削除できませんでした"),
              e instanceof ApiRequestError
                ? t(e.message, { defaultValue: e.message })
                : t("視聴履歴の削除に失敗しました"),
            ),
          );
      },
      {
        confirmLabel: t("削除"),
        cancelLabel: t("キャンセル"),
        destructive: true,
      },
    );
  }

  // 呼び出し別コールバック（mutate の第2引数）は連続 mutate で
  // 前の呼び出し分が発火しないため、mutation 個別に reject する
  // mutateAsync の promise で失敗を拾う。
  // 「元の状態に戻しました」と言えるのは表示が実際に
  // 巻き戻された場合だけ。後続の楽観値が残る失敗は onError が
  // ロールバックをスキップするため、onError がエラーへ記録する
  // rolledBack で文言を分ける。
  function notifyUpdateFailure(e: unknown) {
    const rolledBack = (e as UpsertWatchHistoryError).rolledBack === true;
    notifyFailure(
      "update",
      t("更新できませんでした"),
      rolledBack
        ? t("視聴ステータスを更新できませんでした。元の状態に戻しました。")
        : t("一部の更新に失敗しました。"),
    );
  }

  // ステータスは行のピッカーで選んだ時点で保存する（issue #379）。
  // 選択 → 保存の 2 段階をやめる代わりに、誤操作は「元に戻す」トーストで
  // 取り消せるようにする。キャッシュは楽観更新済みなので応答を待たない。
  function changeStatus(item: WatchHistoryItem, next: WatchStatus) {
    if (next === item.state) return;
    // 戻し先・計測の from は選択時点の状態。ミューテーション（楽観更新）より
    // 先に取っておかないと、参照のタイミングで変更後の値を拾いうる。
    const previous = item.state;
    // 視聴ステータスの変更操作を計測する（issue #214）。
    trackEvent("watch_status_change", {
      [TRACK_EVENT_KEYS.from]: previous,
      [TRACK_EVENT_KEYS.to]: next,
    });
    void upsert
      .mutateAsync({ annictWorkId: item.annictWorkId, data: { state: next } })
      .catch((e) => {
        // 表示が巻き戻された失敗では成功を示すトーストが残ると矛盾するので消す。
        // 後続の楽観値が残る失敗（rolledBack=false）では別の変更分のトーストを
        // 消さないよう、対象作品のトーストだけを消す。
        if ((e as UpsertWatchHistoryError).rolledBack === true) {
          setStatusToast((cur) =>
            cur?.annictWorkId === item.annictWorkId ? null : cur,
          );
        }
        notifyUpdateFailure(e);
      });
    showStatusToast({
      annictWorkId: item.annictWorkId,
      title: item.title,
      previousState: previous,
      toLabel: t(WATCH_STATUS_LABELS[next]),
    });
  }

  function showStatusToast(toast: StatusUndoToast) {
    setStatusToast(toast);
    if (statusToastTimer.current) clearTimeout(statusToastTimer.current);
    statusToastTimer.current = setTimeout(
      () => setStatusToast(null),
      STATUS_TOAST_MS,
    );
  }

  function dismissStatusToast() {
    if (statusToastTimer.current) clearTimeout(statusToastTimer.current);
    setStatusToast(null);
  }

  // 「元に戻す」: 直前のステータスへ戻す保存をもう一度発行する。
  // 戻す操作自体の失敗も通常の更新と同じ通知経路（ロールバック＋ダイアログ）に載せる。
  function undoStatusChange() {
    const toast = statusToast;
    dismissStatusToast();
    if (!toast) return;
    // 取り消しもステータス変更として計測する。変更後にさらに操作されて
    // いる可能性があるため from は現キャッシュの状態を参照する。
    const current = enriched.find(
      (h) => h.annictWorkId === toast.annictWorkId,
    )?.state;
    // 一覧から消えている（変更後に履歴ごと削除された等）なら何もしない。
    // PUT は upsert なので送ると削除した履歴が復活してしまう。
    if (current == null) return;
    // 既に直前の状態へ戻っている（更新失敗でロールバック済み等）なら
    // 同じステータスへの無駄な PUT を送らない。
    if (current === toast.previousState) return;
    trackEvent("watch_status_change", {
      [TRACK_EVENT_KEYS.from]: current,
      [TRACK_EVENT_KEYS.to]: toast.previousState,
    });
    void upsert
      .mutateAsync({
        annictWorkId: toast.annictWorkId,
        data: { state: toast.previousState },
      })
      .catch(notifyUpdateFailure);
  }

  // 連携状態の確定前はスピナー（未連携かどうかが分かるまで履歴 UI を出さない）。
  if (isConnectionLoading) {
    return (
      <View className="flex-1 bg-white dark:bg-slate-900">
        <ListLoadingSkeleton accessibilityLabel={t("読み込み中")} />
      </View>
    );
  }

  // 未連携: 履歴クエリは無効化されているため、連携誘導を最優先で表示する。
  if (!isConnected) {
    return (
      <View className="flex-1 bg-white dark:bg-slate-900">
        <AnnictSoftGate
          description="視聴履歴を表示するには Annict との連携が必要です。連携すると、Annict の視聴記録がアニメ名刺に反映されます。"
          surface="watch_history"
          testID="watch-history-soft-gate"
        />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-white dark:bg-slate-900">
        <ListLoadingSkeleton accessibilityLabel={t("読み込み中")} />
      </View>
    );
  }

  if (isError && !histories) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900 px-8">
        <Text className="text-danger text-center mb-4">
          {t("視聴履歴の取得に失敗しました")}
        </Text>
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel={t("視聴履歴を再取得")}
        >
          <Text className="text-white font-semibold">{t("再試行")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-slate-900">
      <FlatList
        testID="watch-history-list"
        // numColumns の途中変更は未対応なので、列数が変わるたびに再マウントする
        // （アニメ一覧と同じ対処）。
        key={`watch-history-${grid.numColumns}`}
        data={visible}
        numColumns={grid.numColumns}
        keyExtractor={(item) => String(item.annictWorkId)}
        // 下端はネイティブのタブバーに潜り込むため、最後の行がその下に
        // 隠れないようタブバー分の inset を余白へ足す（issue #462）。
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          paddingBottom: 32 + insets.bottom,
          ...(isGrid ? { alignItems: "center" as const } : null),
        }}
        columnWrapperStyle={
          isGrid
            ? {
                width: grid.contentWidth,
                gap: GRID_GAP,
                justifyContent: "flex-start",
              }
            : undefined
        }
        refreshing={refreshing}
        onRefresh={onRefresh}
        // 件数・共有 URL・ソート/絞り込みはヘッダーとして一覧と一緒に流す
        // （issue #470）。要素として渡し、コンポーネント関数の再生成による
        // リマウント（スクロール位置リセット）を避ける。
        ListHeaderComponent={
          // グリッド時は行の並ぶコンテンツ幅に揃えて中央寄せする。
          <View
            style={
              isGrid
                ? { width: grid.contentWidth, alignSelf: "center" }
                : undefined
            }
          >
            <View className="px-4 pt-1 pb-3 flex-row items-center justify-between">
              <Text className="text-xs text-muted">
                {filterActive
                  ? t("{{visible}} / {{total}} 件", {
                      visible: visible.length,
                      total: enriched.length,
                    })
                  : t("{{count}} 件", { count: enriched.length })}
              </Text>
              {/* dアニメ取り込みの導線。フラグ無効時（#751 の env 切り戻し）
                  ・停止スイッチ（#758）が入っている間は出さない。 */}
              {danimeImportEnabled && (
                <TouchableOpacity
                  className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-1.5"
                  onPress={() => router.push("/danime-import")}
                  accessibilityRole="button"
                  accessibilityLabel={t("dアニメストアからインポート")}
                  testID="danime-import-button"
                >
                  <Text className="text-xs text-primary-text font-medium">
                    {t("dアニメからインポート")}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* 共有 URL 導線（#236）。#170 のタブ再編に備えて独立コンポーネントに分離。 */}
            <WatchHistoryShareSection />

            {/* ソート切り替えチップ + 絞り込み導線（issue #345）。
                絞り込みの選択自体は下のボトムシートで行う。
                react-native-web の ScrollView は flexGrow/flexShrink が 1 既定で、
                兄弟要素に押されて高さが潰れうるため明示的に無効化する（#371）。 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, flexShrink: 0 }}
              className="px-4 pb-2"
              contentContainerStyle={{ gap: 8 }}
              testID="watch-history-sort-row"
            >
              {WATCH_HISTORY_SORT_KEYS.map((key) => (
                <SelectChip
                  key={key}
                  label={t(WATCH_HISTORY_SORT_LABELS[key])}
                  selected={sortKey === key}
                  onPress={() => setSortKey(key)}
                  accessibilityLabel={t("{{label}}で並べ替え", {
                    label: t(WATCH_HISTORY_SORT_LABELS[key]),
                  })}
                  testID={`watch-history-sort-${key}`}
                />
              ))}
              <FilterOpenChip
                label={t("絞り込み")}
                active={filterActive}
                onPress={() => setFilterSheetOpen(true)}
                accessibilityLabel={
                  filterActive
                    ? t("視聴履歴を絞り込む（適用中）")
                    : t("視聴履歴を絞り込む")
                }
                testID="watch-history-filter-button"
              />
            </ScrollView>
          </View>
        }
        ItemSeparatorComponent={
          isGrid
            ? undefined
            : () => (
                <View
                  style={{ height: 1 }}
                  className="mx-4 bg-slate-100 dark:bg-slate-800"
                />
              )
        }
        renderItem={({ item }) => (
          <View style={isGrid ? { width: grid.columnWidth } : undefined}>
            <WatchHistoryRow
              history={item}
              onStatusChange={(next) => changeStatus(item, next)}
              onDelete={() => confirmDelete(item.annictWorkId)}
              isFavorite={favoriteIds.has(item.annictWorkId)}
              favoriteDisabled={isTogglingFavorite}
              onToggleFavorite={() => toggleFavorite(item.annictWorkId)}
              onAddToList={() => setListTarget(item)}
              onOpenDetail={() => setDetailWork(item)}
            />
            {/* グリッドでは行間セパレータが列をまたいで引けないため、
                各行と同じ余白でセルの下辺に線を引く。 */}
            {isGrid ? (
              <View
                style={{ height: 1 }}
                className="mx-4 bg-slate-100 dark:bg-slate-800"
              />
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-muted text-center">
              {enriched.length > 0 && filterActive
                ? t("絞り込み条件に一致する履歴がありません。")
                : t("視聴履歴がありません。\nアニメ一覧から追加してください。")}
            </Text>
          </View>
        }
      />

      {filterSheetOpen && (
        <FilterSheet
          decades={decades}
          filters={filters}
          onChange={setFilters}
          onClose={() => setFilterSheetOpen(false)}
        />
      )}

      {/* 「リストに追加」シート（issue #379）。アニメ一覧と同じシートを
          作品情報の最小セット（id・タイトル）で開く。 */}
      <AddToWorkListSheet
        work={
          listTarget
            ? {
                annictWorkId: listTarget.annictWorkId,
                title: listTarget.title,
              }
            : null
        }
        onClose={() => setListTarget(null)}
      />

      <AnimeWorkDetailSheet
        work={detailWork}
        onClose={() => setDetailWork(null)}
        isFavorite={
          detailWork != null && favoriteIds.has(detailWork.annictWorkId)
        }
        isTogglingFavorite={isTogglingFavorite}
        onToggleFavorite={() => {
          if (detailWork) toggleFavorite(detailWork.annictWorkId);
        }}
        onOpenCharacterTierList={openCharacterTierList}
      />

      {/* ステータス変更の「元に戻す」トースト。一覧を操作し続けられるよう
          タップを通すオーバーレイに置き、時間で消える（issue #379）。 */}
      <View
        testID="watch-history-toast-layer"
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          // タブバーの下に潜らないよう safe area 分だけ持ち上げる（issue #462）
          bottom: insets.bottom,
          zIndex: 20,
        }}
      >
        {statusToast ? (
          <View
            className="mx-4 mb-4 flex-row items-center rounded-lg bg-slate-800 px-4 py-3 shadow-md dark:bg-slate-700"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text className="flex-1 text-sm text-white">
              {t("{{title}}を「{{state}}」に変更しました", {
                title: statusToast.title,
                state: statusToast.toLabel,
              })}
            </Text>
            <TouchableOpacity
              onPress={undoStatusChange}
              className="ml-3 py-1"
              accessibilityRole="button"
              accessibilityLabel={t("元に戻す")}
              testID="watch-history-status-undo"
            >
              <Text className="text-sm font-semibold text-indigo-300">
                {t("元に戻す")}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ソート・絞り込みの選択チップ。
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
      {...selectionAccessibilityProps(selected)}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      <Text
        className={`text-xs font-medium ${
          selected ? "text-primary-text" : "text-muted"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// 押しても選択状態は切り替わらず、絞り込みシートを開くだけのチップ。
// active は適用中である見た目だけに使い、aria-pressed / selected にはしない。
function FilterOpenChip({
  label,
  active,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`px-3 py-1.5 rounded-full border ${
        active
          ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
          : "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
      }`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      <Text
        className={`text-xs font-medium ${
          active ? "text-primary-text" : "text-muted"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// 放送年代・視聴状態の絞り込みシート（issue #345）。
// 選択は即時に一覧へ反映し、「絞り込みを適用」またはスワイプで閉じる。
function FilterSheet({
  decades,
  filters,
  onChange,
  onClose,
}: {
  decades: WatchHistoryDecade[];
  filters: WatchHistoryFilters;
  onChange: (next: WatchHistoryFilters) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toggleState = (state: WatchStatus) =>
    onChange({
      ...filters,
      states: filters.states.includes(state)
        ? filters.states.filter((s) => s !== state)
        : [...filters.states, state],
    });

  return (
    <BottomSheet
      visible
      onClose={onClose}
      scrimAccessibilityLabel={t("絞り込みを閉じる")}
      testID="watch-history-filter-sheet"
    >
      <View className="px-6 pt-6 pb-10">
        <Text className="text-lg font-bold text-foreground mb-5">
          {t("絞り込み")}
        </Text>

        <Text className="text-sm font-medium text-secondary mb-2">
          {t("放送年代")}
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-5">
          <SelectChip
            label={t("すべて")}
            selected={filters.decade === null}
            onPress={() => onChange({ ...filters, decade: null })}
            accessibilityLabel={t("すべての放送年代")}
          />
          {decades.map((decade) => (
            <SelectChip
              key={String(decade)}
              label={
                decade === "unknown"
                  ? t("年不明")
                  : t("{{decade}}年代", { decade })
              }
              selected={filters.decade === decade}
              onPress={() => onChange({ ...filters, decade })}
              accessibilityLabel={
                decade === "unknown"
                  ? t("放送年が未設定の作品")
                  : t("{{decade}}年代で絞り込む", { decade })
              }
            />
          ))}
        </View>

        <Text className="text-sm font-medium text-secondary mb-2">
          {t("視聴状態")}
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-6">
          {WATCH_STATUSES.map((s) => (
            <SelectChip
              key={s}
              label={t(WATCH_STATUS_LABELS[s])}
              selected={filters.states.includes(s)}
              onPress={() => toggleState(s)}
              accessibilityLabel={t("{{label}}で絞り込む", {
                label: t(WATCH_STATUS_LABELS[s]),
              })}
            />
          ))}
        </View>
        <Text className="text-xs text-muted mb-5">
          {t("視聴状態を未選択にするとすべての状態を表示します")}
        </Text>

        <View className="flex-row gap-3">
          <TouchableOpacity
            className="flex-1 border border-slate-200 dark:border-slate-600 rounded-xl py-3 items-center"
            onPress={() => onChange(NO_WATCH_HISTORY_FILTERS)}
            accessibilityRole="button"
            accessibilityLabel={t("絞り込みをリセット")}
          >
            <Text className="text-secondary font-medium">{t("リセット")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-indigo-600 rounded-xl py-3 items-center"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("絞り込みを適用")}
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

// 視聴履歴の 1 行。ステータスは行のピッカーで選んだ時点で保存され、
// 編集モーダルの「選択 → 保存」の 2 段階は持たない（issue #379）。
// 誤操作はセクション側の「元に戻す」トーストで取り消す。
function WatchHistoryRow({
  history,
  onStatusChange,
  onDelete,
  isFavorite,
  favoriteDisabled,
  onToggleFavorite,
  onAddToList,
  onOpenDetail,
}: {
  history: WatchHistoryItem;
  onStatusChange: (next: WatchStatus) => void;
  onDelete: () => void;
  isFavorite: boolean;
  favoriteDisabled: boolean;
  onToggleFavorite: () => void;
  onAddToList: () => void;
  onOpenDetail: () => void;
}) {
  const { t, i18n } = useTranslation();

  // 放送年・視聴者数はソートの判断材料になるため補足として並べる
  // （issue #345）。どちらも未取得の作品は該当部分を出さない。
  const meta = [
    history.seasonYear != null
      ? t("{{year}}年", { year: history.seasonYear })
      : null,
    history.watchersCount != null
      ? t("視聴者 {{countText}}人", {
          count: history.watchersCount,
          countText: history.watchersCount.toLocaleString(i18n.language),
        })
      : null,
  ]
    .filter((part): part is string => part != null)
    .join(" ・ ");

  return (
    <View
      className="flex-row px-4 py-3 gap-3"
      testID={`watch-history-item-${history.annictWorkId}`}
    >
      {/* サムネ・タイトルは作品詳細シートを開く導線（issue #471）。
          行内に他のボタンがあるため、押せるのはこの 2 要素だけに絞る。 */}
      <TouchableOpacity
        onPress={onOpenDetail}
        accessibilityRole="button"
        accessibilityLabel={t("{{title}} の詳細を開く", {
          title: history.title,
        })}
        testID={`watch-history-detail-thumb-${history.annictWorkId}`}
      >
        <WorkThumbnail uri={history.hostedImageUrl} title={history.title} />
      </TouchableOpacity>

      <View className="flex-1">
        <TouchableOpacity
          onPress={onOpenDetail}
          accessibilityRole="button"
          accessibilityLabel={t("{{title}} の詳細を開く", {
            title: history.title,
          })}
          testID={`watch-history-detail-title-${history.annictWorkId}`}
        >
          <Text className="text-foreground font-medium" numberOfLines={2}>
            {history.title}
          </Text>
        </TouchableOpacity>
        <View className="flex-row items-center gap-2 mt-1 flex-wrap">
          <MenuPicker
            testID={`watch-history-status-${history.annictWorkId}`}
            accessibilityLabel={t("{{title}}の視聴ステータスを変更", {
              title: history.title,
            })}
            title={t("視聴ステータスを変更")}
            closeAccessibilityLabel={t("視聴ステータスの選択を閉じる")}
            selectedValue={history.state}
            options={WATCH_STATUSES.map((s) => ({
              label: t(WATCH_STATUS_LABELS[s]),
              value: s,
              accessibilityLabel: t("{{state}}に変更", {
                state: t(WATCH_STATUS_LABELS[s]),
              }),
            }))}
            onValueChange={onStatusChange}
          />
          {meta ? <Text className="text-xs text-muted">{meta}</Text> : null}
        </View>
        <View className="flex-row items-center gap-2 mt-2">
          <FavoriteButton
            isFavorite={isFavorite}
            disabled={favoriteDisabled}
            onPress={onToggleFavorite}
            title={history.title}
          />
          <AddToWorkListButton
            onPress={onAddToList}
            title={history.title}
            testID={`watch-history-add-to-list-${history.annictWorkId}`}
          />
          <TouchableOpacity
            onPress={onDelete}
            className="bg-red-50 dark:bg-red-950 rounded-lg px-3 py-1.5"
            accessibilityRole="button"
            accessibilityLabel={t("{{title}} の視聴履歴を削除", {
              title: history.title,
            })}
          >
            <Text className="text-xs text-danger">{t("削除")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
