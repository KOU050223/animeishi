// dアニメインポートのレビュー画面（ハイブリッド方式）。
//
//   - exact（高確度一致）: 既定でチェック ON
//   - candidates（曖昧）: ユーザーが候補から選ぶまで未チェック
//   - none（未マッチ）: スキップ表示
// さらに Annict 上の現在ステータスと突き合わせ、
//   - 同じステータスが既に登録済み → 既定で除外（再登録しても意味がない）
//   - WATCHED 済みの作品へ WATCHING を登録しようとする → ダウングレードなので既定で除外
//   - 履歴が未取得のまま照合が終わっても安全に扱うため、照合は履歴クエリの
//     完了を待ってから実行し、取得失敗時は WATCHING 対象を既定で保留にする
// 確定後は 50 件ずつ /me/watch-histories/bulk に送り、進捗と失敗を表示する。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { ListRenderItem } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDanimeImportStore } from "@/store/danimeImportStore";
import {
  useBulkRegisterWatchHistory,
  useDanimeMatch,
} from "@/lib/danime/useDanimeImport";
import type { BulkRegisterEntry } from "@/lib/danime/useDanimeImport";
import type { DanimeAnnictWork, DanimeMatchItem } from "@/lib/danime/types";
import { useWatchHistory, WATCH_STATUS_LABELS } from "@/lib/useWatchHistory";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";

type Row = {
  item: DanimeMatchItem;
  /** 登録対象として選ばれている Annict 作品。null なら登録不可。 */
  selected: DanimeAnnictWork | null;
  checked: boolean;
  /** 「登録済みのため除外」などの注記。 */
  note: string | null;
};

type DoneResult = {
  succeeded: number;
  failed: number;
  aborted: boolean;
  requestError: string | null;
};

// Annict の現在ステータスと突き合わせて既定の checked / note を決める。
// historyUnknown=true（履歴クエリ失敗・未取得）のときは WATCHING 登録を
// 降格させ得るため既定で保留にする。WATCHED 登録は降格になり得ないので許可する。
function defaultChecked(
  item: DanimeMatchItem,
  selected: DanimeAnnictWork | null,
  currentState: string | undefined,
  historyUnknown: boolean,
): { checked: boolean; note: string | null } {
  if (!selected) return { checked: false, note: null };
  if (historyUnknown && item.targetState === "WATCHING") {
    return {
      checked: false,
      note: "Annict の現在ステータスを取得できなかったため保留",
    };
  }
  if (currentState === item.targetState) {
    return {
      checked: false,
      note: `Annict で「${WATCH_STATUS_LABELS[item.targetState]}」登録済み`,
    };
  }
  if (currentState === "WATCHED" && item.targetState === "WATCHING") {
    // 視聴済みを視聴中へ下げるのは意図しない操作になりやすいので既定で除外。
    return { checked: false, note: "Annict で視聴済みのため除外" };
  }
  return { checked: true, note: null };
}

export default function DanimeImportReviewScreen() {
  const router = useRouter();
  const lists = useDanimeImportStore((s) => s.lists);
  const setLists = useDanimeImportStore((s) => s.setLists);

  const match = useDanimeMatch();
  const bulk = useBulkRegisterWatchHistory();
  // isLoading はクエリ無効化（Annict 未連携）時も false になるため、
  // 「ロード完了 or 無効 or 失敗」= !isLoading を待機条件に使う。
  const { data: histories, isLoading: isHistoriesLoading } = useWatchHistory();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const startedRef = useRef(false);

  // 履歴が届いていない（クエリ失敗・未連携）なら既存ステータスは不明として扱う。
  const historyUnknown = histories === undefined;

  // 既存ステータスの索引（ダウングレード防止用）。
  const currentStates = useMemo(() => {
    const m = new Map<number, string>();
    for (const h of histories ?? []) m.set(h.annictWorkId, h.state);
    return m;
  }, [histories]);

  // 照合 API に渡す登録済み作品 ID（別シーズン候補の除外ヒント）。
  const registeredWorkIds = useMemo(
    () => (histories ?? []).map((h) => h.annictWorkId),
    [histories],
  );

  const buildRows = useCallback(
    (results: DanimeMatchItem[]): Row[] => {
      const built = results.map((item) => {
        const selected = item.status === "exact" ? item.work : null;
        const { checked, note } = defaultChecked(
          item,
          selected,
          selected ? currentStates.get(selected.annictWorkId) : undefined,
          historyUnknown,
        );
        return { item, selected, checked, note };
      });
      // 異なる dアニメ workId の行が同じ Annict 作品にマッチした場合、
      // WATCHED と WATCHING の両方を送ると後勝ちで降格する。
      // WATCHED 側を残し、WATCHING 側は既定で外す。
      const watchedIds = new Set(
        built
          .filter((r) => r.checked && r.item.targetState === "WATCHED")
          .map((r) => r.selected!.annictWorkId),
      );
      return built.map((r) =>
        r.item.targetState === "WATCHING" &&
        r.selected &&
        watchedIds.has(r.selected.annictWorkId)
          ? {
              ...r,
              checked: false,
              note: "同じ作品が視聴済みでも登録予定のため除外",
            }
          : r,
      );
    },
    [currentStates, historyUnknown],
  );

  // マッチングは 1 度だけ実行（StrictMode の二重 effect 対策）。
  // 既存ステータスによる降格防止を正しく効かせるため、履歴クエリの
  // 完了（成功/失敗/無効のいずれか）を待ってから照合する。
  useEffect(() => {
    if (!lists || startedRef.current || isHistoriesLoading) return;
    startedRef.current = true;
    match.mutate(
      { lists, registeredWorkIds },
      {
        onSuccess: (results) => setRows(buildRows(results)),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, isHistoriesLoading, registeredWorkIds]);

  const toggleRow = useCallback((index: number) => {
    setRows(
      (prev) =>
        prev?.map((r, i) =>
          i === index && r.selected ? { ...r, checked: !r.checked } : r,
        ) ?? null,
    );
  }, []);

  const selectCandidate = useCallback(
    (rowIndex: number, work: DanimeAnnictWork) => {
      setRows(
        (prev) =>
          prev?.map((r, i) => {
            if (i !== rowIndex) return r;
            const { note } = defaultChecked(
              r.item,
              work,
              currentStates.get(work.annictWorkId),
              historyUnknown,
            );
            // 候補選択は「登録したい」意思表示なのでチェック ON にする。
            // ダウングレード等の注意は note として残す。
            return { ...r, selected: work, checked: true, note };
          }) ?? null,
      );
    },
    [currentStates, historyUnknown],
  );

  const renderRow = useCallback<ListRenderItem<Row>>(
    ({ item: row, index }) => (
      <ReviewRow
        row={row}
        index={index}
        currentStates={currentStates}
        onToggle={toggleRow}
        onSelectCandidate={selectCandidate}
      />
    ),
    [currentStates, toggleRow, selectCandidate],
  );

  if (!lists) {
    // ストアが空 = 取込画面を経ずに来た → 取込画面へ戻す。
    return <Redirect href="/danime-import" />;
  }

  const checkedCount = rows?.filter((r) => r.checked && r.selected).length ?? 0;

  function register() {
    if (!rows) return;
    // 同一 Annict 作品への重複登録は WATCHED を優先して 1 件に潰す
    // （buildRows の UI 側除外とは別の最終防衛線）。
    const byId = new Map<number, BulkRegisterEntry>();
    for (const r of rows) {
      if (!r.checked || !r.selected) continue;
      const prev = byId.get(r.selected.annictWorkId);
      if (
        prev &&
        !(prev.state === "WATCHING" && r.item.targetState === "WATCHED")
      )
        continue;
      byId.set(r.selected.annictWorkId, {
        annictWorkId: r.selected.annictWorkId,
        state: r.item.targetState,
      });
    }
    const entries = [...byId.values()];
    if (entries.length === 0) return;
    setProgress({ done: 0, total: entries.length });
    bulk.mutate(
      {
        entries,
        onProgress: (done, total) => setProgress({ done, total }),
      },
      {
        onSuccess: (res) => {
          setDoneResult({
            succeeded: res.results.filter((r) => r.ok).length,
            failed: res.results.filter((r) => !r.ok).length,
            aborted: res.aborted,
            requestError: res.requestError,
          });
        },
        onSettled: () => setProgress(null),
      },
    );
  }

  function close() {
    setLists(null);
    router.replace("/(tabs)/watch-history");
  }

  function retryMatch() {
    match.reset();
    match.mutate(
      { lists: lists!, registeredWorkIds },
      {
        onSuccess: (results) => setRows(buildRows(results)),
      },
    );
  }

  // ---- 結果画面 ----
  if (doneResult) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Text className="text-lg font-bold text-gray-900">登録結果</Text>
        <Text className="text-sm text-gray-600 mt-3 text-center">
          成功: {doneResult.succeeded} 件 / 失敗・未処理: {doneResult.failed} 件
        </Text>
        {doneResult.aborted && (
          <Text className="text-xs text-red-500 mt-2 text-center">
            Annict
            連携が切れたため途中で中断されました。連携を確認して再度お試しください。
          </Text>
        )}
        {doneResult.requestError && (
          <Text className="text-xs text-red-500 mt-2 text-center">
            {doneResult.requestError}
          </Text>
        )}
        <TouchableOpacity
          className="mt-6 bg-indigo-600 rounded-xl px-8 py-3"
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="視聴履歴へ戻る"
        >
          <Text className="text-white font-semibold">視聴履歴へ戻る</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ---- マッチング中 / 失敗 ----
  if (rows === null) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        {match.isPending || isHistoriesLoading ? (
          <>
            <ActivityIndicator size="large" color="#4f46e5" />
            <Text className="text-sm text-gray-500 mt-4">
              Annict の作品と照合しています…
            </Text>
          </>
        ) : (
          <>
            <Text className="text-sm text-red-500 text-center">
              {match.error?.message ?? "マッチングに失敗しました"}
            </Text>
            <TouchableOpacity
              className="mt-4 bg-indigo-600 rounded-xl px-8 py-3"
              onPress={retryMatch}
              accessibilityRole="button"
              accessibilityLabel="再試行"
            >
              <Text className="text-white font-semibold">再試行</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="mt-2 py-2"
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="戻る"
            >
              <Text className="text-gray-500">戻る</Text>
            </TouchableOpacity>
          </>
        )}
      </SafeAreaView>
    );
  }

  // ---- レビュー一覧 ----
  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="px-4 pt-2 pb-3 border-b border-gray-100">
        <Text className="text-xl font-bold text-gray-900">
          インポート内容の確認
        </Text>
        <Text className="text-xs text-gray-500 mt-1">
          {rows.length} 件中 {checkedCount} 件を登録します
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.item.danimeWorkId}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        renderItem={renderRow}
      />

      <View className="px-4 py-3 border-t border-gray-100">
        {progress !== null && (
          <Text className="text-xs text-gray-500 text-center mb-2">
            登録中… {progress.done} / {progress.total}
          </Text>
        )}
        {bulk.isError && (
          <Text className="text-xs text-red-500 text-center mb-2">
            {bulk.error.message}
          </Text>
        )}
        <TouchableOpacity
          className={`rounded-xl py-3 items-center ${
            checkedCount > 0 && !bulk.isPending
              ? "bg-indigo-600"
              : "bg-gray-300"
          }`}
          onPress={register}
          disabled={checkedCount === 0 || bulk.isPending}
          accessibilityRole="button"
          accessibilityLabel="Annict に登録"
          testID="danime-register-button"
        >
          {bulk.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-white font-semibold">
              {checkedCount} 件を Annict に登録
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          className="mt-2 py-2 items-center"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="戻る"
        >
          <Text className="text-gray-500">戻る</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ---- 行コンポーネント ----

function ReviewRow({
  row,
  index,
  currentStates,
  onToggle,
  onSelectCandidate,
}: {
  row: Row;
  index: number;
  currentStates: Map<number, string>;
  onToggle: (index: number) => void;
  onSelectCandidate: (index: number, work: DanimeAnnictWork) => void;
}) {
  const { item, selected, checked, note } = row;
  const stateLabel = item.targetState === "WATCHED" ? "視聴済" : "視聴中";
  const stateColor = item.targetState === "WATCHED" ? "#16a34a" : "#4f46e5";

  return (
    <View className="py-3 border-b border-gray-100">
      <View className="flex-row items-center gap-3">
        <TouchableOpacity
          onPress={() => onToggle(index)}
          disabled={!selected}
          className={`w-6 h-6 rounded-md border items-center justify-center ${
            checked && selected
              ? "bg-indigo-600 border-indigo-600"
              : "border-gray-300"
          }`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: checked && !!selected }}
          accessibilityLabel={`${item.title} を登録対象にする`}
        >
          {checked && selected !== null && (
            <Text className="text-white text-xs font-bold">✓</Text>
          )}
        </TouchableOpacity>

        <View className="flex-1">
          <Text className="text-gray-900 font-medium" numberOfLines={2}>
            {item.title}
          </Text>
          <RowBadges
            targetLabel={stateLabel}
            targetColor={stateColor}
            status={item.status}
            selected={selected}
            note={note}
          />
          {selected !== null && (
            <SelectedWork
              work={selected}
              currentState={currentStates.get(selected.annictWorkId)}
            />
          )}
        </View>
      </View>

      {item.status === "candidates" && (
        <CandidatePicker
          candidates={item.candidates}
          selected={selected}
          rowIndex={index}
          onSelect={onSelectCandidate}
        />
      )}
    </View>
  );
}

function RowBadges({
  targetLabel,
  targetColor,
  status,
  selected,
  note,
}: {
  targetLabel: string;
  targetColor: string;
  status: DanimeMatchItem["status"];
  selected: DanimeAnnictWork | null;
  note: string | null;
}) {
  return (
    <View className="flex-row items-center gap-2 mt-1 flex-wrap">
      <Text
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ color: targetColor, backgroundColor: `${targetColor}20` }}
      >
        {targetLabel}に登録
      </Text>
      {status === "exact" && selected !== null && (
        <Text className="text-xs text-green-600">自動マッチ</Text>
      )}
      {status === "none" && (
        <Text className="text-xs text-gray-400">
          Annict に一致する作品が見つかりません（スキップ）
        </Text>
      )}
      {note !== null && <Text className="text-xs text-amber-600">{note}</Text>}
    </View>
  );
}

function SelectedWork({
  work,
  currentState,
}: {
  work: DanimeAnnictWork;
  currentState: string | undefined;
}) {
  const stateLabel = currentState
    ? (WATCH_STATUS_LABELS[currentState as keyof typeof WATCH_STATUS_LABELS] ??
      currentState)
    : null;

  return (
    <View className="flex-row items-center gap-2 mt-2">
      <WorkThumbnail item={work} width={32} height={42} />
      <View className="flex-1">
        <Text className="text-xs text-gray-600" numberOfLines={2}>
          → {work.title}
        </Text>
        {stateLabel !== null && (
          <Text className="text-[10px] text-gray-400">現在: {stateLabel}</Text>
        )}
      </View>
    </View>
  );
}

function CandidatePicker({
  candidates,
  selected,
  rowIndex,
  onSelect,
}: {
  candidates: DanimeAnnictWork[];
  selected: DanimeAnnictWork | null;
  rowIndex: number;
  onSelect: (index: number, work: DanimeAnnictWork) => void;
}) {
  return (
    <View className="mt-2 ml-9 gap-1">
      {candidates.map((c) => {
        const isSelected = selected?.annictWorkId === c.annictWorkId;
        return (
          <TouchableOpacity
            key={c.annictWorkId}
            onPress={() => onSelect(rowIndex, c)}
            className={`flex-row items-center gap-2 rounded-lg border px-2 py-1.5 ${
              isSelected
                ? "border-indigo-500 bg-indigo-50"
                : "border-gray-200 bg-white"
            }`}
            accessibilityRole="button"
            accessibilityLabel={`候補: ${c.title}`}
          >
            <WorkThumbnail item={c} width={24} height={32} />
            <Text className="flex-1 text-xs text-gray-700" numberOfLines={2}>
              {c.title}
              {c.seasonYear ? `（${c.seasonYear}年）` : ""}
            </Text>
            {isSelected && (
              <Text className="text-xs text-indigo-600 font-bold">選択中</Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
