import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  useWatchHistory,
  useUpsertWatchHistory,
  useDeleteWatchHistory,
  WATCH_STATUS_LABELS,
} from "@/lib/useWatchHistory";
import type {
  WatchHistoryItem,
  UpsertWatchHistoryError,
} from "@/lib/useWatchHistory";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";
import { ApiRequestError } from "@/lib/apiError";
import { alert, confirm } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { featureFlags } from "@/lib/featureFlags";
import { useAnnictConnection } from "@/lib/annict";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { WatchHistoryShareSection } from "@/components/watch-history/WatchHistoryShareSection";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MenuPicker } from "@/components/ui/menu-picker";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { FavoriteButton } from "@/components/anime-list/FavoriteButton";
import {
  AddToWorkListButton,
  AddToWorkListSheet,
} from "@/components/work-list";
import { useThemeColors } from "@/lib/theme";
import {
  NO_WATCH_HISTORY_FILTERS,
  WATCH_HISTORY_SORT_KEYS,
  WATCH_HISTORY_SORT_LABELS,
  collectWatchHistoryDecades,
  filterWatchHistory,
  isWatchHistoryFilterActive,
  sortWatchHistory,
} from "@/lib/watchHistorySortFilter";
import type {
  WatchHistoryDecade,
  WatchHistoryFilters,
  WatchHistorySortKey,
} from "@/lib/watchHistorySortFilter";

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
function mergedFailureMessage(kind: FailureKind, count: number): string {
  return kind === "update"
    ? `${count}件の視聴ステータス更新に失敗しました。`
    : `${count}件の視聴履歴削除に失敗しました`;
}

// 「元に戻す」トーストの自動で消えるまでの時間。スナックバー相当の
// 操作猶予として 5 秒取る（短すぎると気づく前に消える）。
const STATUS_TOAST_MS = 5000;

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
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  // 「リストに追加」シートの対象作品（issue #379）。
  const [listTarget, setListTarget] = useState<WatchHistoryItem | null>(null);
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
  // onClose から再帰するため関数名式にしている（const 名を本体から参照すると
  // 初期化中の変数アクセスとして React Compiler 系 lint に引っかかる）。
  const flushFailures = useCallback(function flushFailures() {
    if (failureAlertOpenRef.current) return;
    const first = failureQueueRef.current.shift();
    if (!first) return;
    // 直後に同じ種類が続くなら、件数をまとめて1件の通知にする。
    let count = 1;
    while (failureQueueRef.current[0]?.kind === first.kind) {
      failureQueueRef.current.shift();
      count += 1;
    }
    failureAlertOpenRef.current = true;
    alert(
      first.title,
      count === 1 ? first.message : mergedFailureMessage(first.kind, count),
      {
        okLabel: "OK",
        onClose: () => {
          failureAlertOpenRef.current = false;
          flushFailures();
        },
      },
    );
  }, []);
  const notifyFailure = useCallback(
    (kind: FailureKind, title: string, message: string) => {
      failureQueueRef.current.push({ kind, title, message });
      flushFailures();
    },
    [flushFailures],
  );

  // ソフトゲート: 視聴履歴は Annict 連携が前提。未連携のうちは useWatchHistory が
  // クエリを無効化しているため、ここで連携誘導を出して導線を与える。
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  const { data: histories, isLoading, isError, refetch } = useWatchHistory();
  const upsert = useUpsertWatchHistory();
  const remove = useDeleteWatchHistory();

  // 各行の「推しに追加」（issue #379）。アニメ一覧と同じフック・ボタンを使う。
  const favoriteIds = useFavoriteIds();
  const { toggle: toggleFavorite, isPending: isTogglingFavorite } =
    useToggleFavorite(favoriteIds, {
      // トグル失敗は画面に変化が残らないため、OK を押すまで消えない
      // ダイアログで必ず伝える（アニメ一覧と同じ方針）。
      onError: (e) =>
        alert(
          t("お気に入りを更新できませんでした"),
          e instanceof ApiRequestError
            ? e.message
            : t("お気に入りの更新に失敗しました"),
          { okLabel: t("OK") },
        ),
    });

  useEffect(
    () => () => {
      if (statusToastTimer.current) clearTimeout(statusToastTimer.current);
    },
    [],
  );

  // histories が undefined の間も参照を安定させ、下の useMemo（年代選択肢・
  // 絞り込み＋ソート）が毎レンダー走り直さないようにする。
  const enriched = useMemo(() => histories ?? [], [histories]);

  // 年代フィルタの選択肢は一覧に出る作品から作る（存在しない年代を出さない）。
  const decades = useMemo(
    () => collectWatchHistoryDecades(enriched),
    [enriched],
  );
  const filterActive = isWatchHistoryFilterActive(filters);
  const visible = useMemo(
    () => sortWatchHistory(filterWatchHistory(enriched, filters), sortKey),
    [enriched, filters, sortKey],
  );

  async function onRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function confirmDelete(annictWorkId: number) {
    confirm(
      "視聴履歴を削除",
      "この視聴履歴を削除しますか？",
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
              "削除できませんでした",
              e instanceof ApiRequestError
                ? e.message
                : "視聴履歴の削除に失敗しました",
            ),
          );
      },
      { confirmLabel: "削除", cancelLabel: "キャンセル", destructive: true },
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
      "更新できませんでした",
      rolledBack
        ? "視聴ステータスを更新できませんでした。元の状態に戻しました。"
        : "一部の更新に失敗しました。",
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
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.primary} />
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
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900 px-8">
        <Text className="text-red-500 dark:text-red-400 text-center mb-4">
          視聴履歴の取得に失敗しました
        </Text>
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel="視聴履歴を再取得"
        >
          <Text className="text-white font-semibold">再試行</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-slate-900">
      <View className="px-4 pt-1 pb-3 flex-row items-center justify-between">
        <Text className="text-xs text-gray-400 dark:text-slate-500">
          {filterActive
            ? `${visible.length} / ${enriched.length}`
            : enriched.length}{" "}
          件
        </Text>
        {/* dアニメ取り込みは v1.0 では Web 版のみ提供（#158）。ネイティブで
            フラグが無効な間は導線を出さない。 */}
        {featureFlags.danimeImport && (
          <TouchableOpacity
            className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-1.5"
            onPress={() => router.push("/danime-import")}
            accessibilityRole="button"
            accessibilityLabel="dアニメストアからインポート"
            testID="danime-import-button"
          >
            <Text className="text-xs text-indigo-600 dark:text-indigo-300 font-medium">
              dアニメからインポート
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 共有 URL 導線（#236）。#170 のタブ再編に備えて独立コンポーネントに分離。 */}
      <WatchHistoryShareSection />

      {/* ソート切り替えチップ + 絞り込み導線（issue #345）。
          絞り込みの選択自体は下のボトムシートで行う。
          react-native-web の ScrollView は flexGrow/flexShrink が 1 既定で、
          同じ列の FlatList（コンテンツ全高ぶんの flex-basis を持つ）に押されて
          Web では高さが潰れる。ネイティブで不要に見える flex 指定だが消せない（#371）。 */}
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
            label={WATCH_HISTORY_SORT_LABELS[key]}
            selected={sortKey === key}
            onPress={() => setSortKey(key)}
            accessibilityLabel={`${WATCH_HISTORY_SORT_LABELS[key]}で並べ替え`}
            testID={`watch-history-sort-${key}`}
          />
        ))}
        <SelectChip
          label="絞り込み"
          selected={filterActive}
          onPress={() => setFilterSheetOpen(true)}
          accessibilityLabel="視聴履歴を絞り込む"
          testID="watch-history-filter-button"
        />
      </ScrollView>

      <FlatList
        data={visible}
        keyExtractor={(item) => String(item.annictWorkId)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => (
          <View
            style={{ height: 1 }}
            className="bg-gray-100 dark:bg-slate-800"
          />
        )}
        renderItem={({ item }) => (
          <WatchHistoryRow
            history={item}
            onStatusChange={(next) => changeStatus(item, next)}
            onDelete={() => confirmDelete(item.annictWorkId)}
            isFavorite={favoriteIds.has(item.annictWorkId)}
            favoriteDisabled={isTogglingFavorite}
            onToggleFavorite={() => toggleFavorite(item.annictWorkId)}
            onAddToList={() => setListTarget(item)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-gray-400 dark:text-slate-500 text-center">
              {enriched.length > 0 && filterActive
                ? "絞り込み条件に一致する履歴がありません。"
                : "視聴履歴がありません。\nアニメ一覧から追加してください。"}
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

      {/* ステータス変更の「元に戻す」トースト。一覧を操作し続けられるよう
          タップを通すオーバーレイに置き、時間で消える（issue #379）。 */}
      <View
        testID="watch-history-toast-layer"
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 20,
        }}
      >
        {statusToast ? (
          <View
            className="mx-4 mb-4 flex-row items-center rounded-lg bg-slate-800 px-4 py-3 shadow-md dark:bg-slate-700"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text className="flex-1 text-sm text-white dark:text-slate-100">
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
          : "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800"
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
            : "text-gray-500 dark:text-slate-400"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// 放送年代・視聴状態の絞り込みシート（issue #345）。
// 選択は即時に一覧へ反映し、「閉じる」またはスワイプで閉じる。
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
      scrimAccessibilityLabel="絞り込みを閉じる"
      testID="watch-history-filter-sheet"
    >
      <View className="px-6 pt-6 pb-10">
        <Text className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-5">
          絞り込み
        </Text>

        <Text className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
          放送年代
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-5">
          <SelectChip
            label="すべて"
            selected={filters.decade === null}
            onPress={() => onChange({ ...filters, decade: null })}
            accessibilityLabel="すべての放送年代"
          />
          {decades.map((decade) => (
            <SelectChip
              key={String(decade)}
              label={decade === "unknown" ? "年不明" : `${decade}年代`}
              selected={filters.decade === decade}
              onPress={() => onChange({ ...filters, decade })}
              accessibilityLabel={
                decade === "unknown"
                  ? "放送年が未設定の作品"
                  : `${decade}年代で絞り込む`
              }
            />
          ))}
        </View>

        <Text className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
          視聴状態
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-6">
          {WATCH_STATUSES.map((s) => (
            <SelectChip
              key={s}
              label={WATCH_STATUS_LABELS[s]}
              selected={filters.states.includes(s)}
              onPress={() => toggleState(s)}
              accessibilityLabel={`${WATCH_STATUS_LABELS[s]}で絞り込む`}
            />
          ))}
        </View>
        <Text className="text-xs text-gray-400 dark:text-slate-500 mb-5">
          視聴状態を未選択にするとすべての状態を表示します
        </Text>

        <View className="flex-row gap-3">
          <TouchableOpacity
            className="flex-1 border border-gray-200 dark:border-slate-600 rounded-xl py-3 items-center"
            onPress={() => onChange(NO_WATCH_HISTORY_FILTERS)}
            accessibilityRole="button"
            accessibilityLabel="絞り込みをリセット"
          >
            <Text className="text-gray-600 dark:text-slate-300 font-medium">
              リセット
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-indigo-600 rounded-xl py-3 items-center"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="絞り込みを適用して閉じる"
          >
            <Text className="text-white font-semibold">閉じる</Text>
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
}: {
  history: WatchHistoryItem;
  onStatusChange: (next: WatchStatus) => void;
  onDelete: () => void;
  isFavorite: boolean;
  favoriteDisabled: boolean;
  onToggleFavorite: () => void;
  onAddToList: () => void;
}) {
  const { t } = useTranslation();

  // 放送年・視聴者数はソートの判断材料になるため補足として並べる
  // （issue #345）。どちらも未取得の作品は該当部分を出さない。
  const meta = [
    history.seasonYear != null ? `${history.seasonYear}年` : null,
    history.watchersCount != null
      ? `視聴者 ${history.watchersCount.toLocaleString("ja-JP")}人`
      : null,
  ]
    .filter((part): part is string => part != null)
    .join(" ・ ");

  return (
    <View
      className="flex-row py-3 gap-3"
      testID={`watch-history-item-${history.annictWorkId}`}
    >
      <WorkThumbnail uri={history.hostedImageUrl} />

      <View className="flex-1">
        <Text
          className="text-gray-900 dark:text-slate-100 font-medium"
          numberOfLines={2}
        >
          {history.title}
        </Text>
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
          {meta ? (
            <Text className="text-xs text-gray-400 dark:text-slate-500">
              {meta}
            </Text>
          ) : null}
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
            accessibilityLabel={`${history.title} の視聴履歴を削除`}
          >
            <Text className="text-xs text-red-500 dark:text-red-400">削除</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
