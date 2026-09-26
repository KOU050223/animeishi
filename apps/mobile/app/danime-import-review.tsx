// dアニメインポートのレビュー画面（ハイブリッド方式）。
//
//   - exact（高確度一致）: 既定でチェック ON
//   - candidates（曖昧）: ユーザーが候補から選ぶまで未チェック
//   - none（未マッチ）: スキップ表示
// さらに Annict 上の現在ステータスと突き合わせ、
//   - 同じステータスが既に登録済み → 既定で除外（再登録しても意味がない）
//   - WATCHED 済みの作品へ WATCHING を登録しようとする → ダウングレードなので既定で除外
// 確定後は 50 件ずつ /me/watch-histories/bulk に送り、進捗と失敗を表示する。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
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

// Annict の現在ステータスと突き合わせて既定の checked / note を決める。
function defaultChecked(
  item: DanimeMatchItem,
  selected: DanimeAnnictWork | null,
  currentState: string | undefined,
): { checked: boolean; note: string | null } {
  if (!selected) return { checked: false, note: null };
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
  const { data: histories } = useWatchHistory();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [doneResult, setDoneResult] = useState<{
    succeeded: number;
    failed: number;
    aborted: boolean;
  } | null>(null);
  const startedRef = useRef(false);

  // 既存ステータスの索引（ダウングレード防止用）。
  const currentStates = useMemo(() => {
    const m = new Map<number, string>();
    for (const h of histories ?? []) m.set(h.annictWorkId, h.state);
    return m;
  }, [histories]);

  function buildRows(results: DanimeMatchItem[]): Row[] {
    return results.map((item) => {
      const selected = item.status === "exact" ? item.work : null;
      const { checked, note } = defaultChecked(
        item,
        selected,
        selected ? currentStates.get(selected.annictWorkId) : undefined,
      );
      return { item, selected, checked, note };
    });
  }

  // マッチングは 1 度だけ実行（StrictMode の二重 effect 対策）。
  useEffect(() => {
    if (!lists || startedRef.current) return;
    startedRef.current = true;
    match.mutate(lists, {
      onSuccess: (results) => setRows(buildRows(results)),
    });
    // currentStates は初回実行時点のものを使う（履歴クエリの到着を待たない）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists]);

  if (!lists) {
    // ストアが空 = 取込画面を経ずに来た → 取込画面へ戻す。
    return <Redirect href="/danime-import" />;
  }

  const checkedCount = rows?.filter((r) => r.checked && r.selected).length ?? 0;

  function toggleRow(index: number) {
    setRows(
      (prev) =>
        prev?.map((r, i) =>
          i === index && r.selected ? { ...r, checked: !r.checked } : r,
        ) ?? null,
    );
  }

  function selectCandidate(rowIndex: number, work: DanimeAnnictWork) {
    setRows(
      (prev) =>
        prev?.map((r, i) => {
          if (i !== rowIndex) return r;
          const { note } = defaultChecked(
            r.item,
            work,
            currentStates.get(work.annictWorkId),
          );
          // 候補選択は「登録したい」意思表示なのでチェック ON にする。
          // ダウングレード等の注意は note として残す。
          return { ...r, selected: work, checked: true, note };
        }) ?? null,
    );
  }

  function register() {
    if (!rows) return;
    const entries: BulkRegisterEntry[] = rows
      .filter((r) => r.checked && r.selected)
      .map((r) => ({
        annictWorkId: r.selected!.annictWorkId,
        nodeId: r.selected!.nodeId,
        state: r.item.targetState,
        work: r.selected!,
      }));
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

  // ---- 結果画面 ----
  if (doneResult) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Text className="text-lg font-bold text-gray-900">登録完了</Text>
        <Text className="text-sm text-gray-600 mt-3 text-center">
          成功: {doneResult.succeeded} 件 / 失敗: {doneResult.failed} 件
        </Text>
        {doneResult.aborted && (
          <Text className="text-xs text-red-500 mt-2 text-center">
            Annict
            連携が切れたため途中で中断されました。連携を確認して再度お試しください。
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
        {match.isPending ? (
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
              onPress={() => {
                match.reset();
                match.mutate(lists, {
                  onSuccess: (results) => setRows(buildRows(results)),
                });
              }}
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
        renderItem={({ item: row, index }) => (
          <ReviewRow
            row={row}
            index={index}
            currentStates={currentStates}
            onToggle={toggleRow}
            onSelectCandidate={selectCandidate}
          />
        )}
      />

      <View className="px-4 py-3 border-t border-gray-100">
        {progress && (
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
          {checked && selected && (
            <Text className="text-white text-xs font-bold">✓</Text>
          )}
        </TouchableOpacity>

        <View className="flex-1">
          <Text className="text-gray-900 font-medium" numberOfLines={2}>
            {item.title}
          </Text>
          <View className="flex-row items-center gap-2 mt-1 flex-wrap">
            <Text
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ color: stateColor, backgroundColor: `${stateColor}20` }}
            >
              {stateLabel}に登録
            </Text>
            {item.status === "exact" && selected && (
              <Text className="text-xs text-green-600">自動マッチ</Text>
            )}
            {item.status === "none" && (
              <Text className="text-xs text-gray-400">
                Annict に一致する作品が見つかりません（スキップ）
              </Text>
            )}
            {note && <Text className="text-xs text-amber-600">{note}</Text>}
          </View>
          {selected && (
            <View className="flex-row items-center gap-2 mt-2">
              <WorkThumbnail item={selected} width={32} height={42} />
              <View className="flex-1">
                <Text className="text-xs text-gray-600" numberOfLines={2}>
                  → {selected.title}
                </Text>
                {currentStates.get(selected.annictWorkId) && (
                  <Text className="text-[10px] text-gray-400">
                    現在:{" "}
                    {WATCH_STATUS_LABELS[
                      currentStates.get(
                        selected.annictWorkId,
                      ) as keyof typeof WATCH_STATUS_LABELS
                    ] ?? currentStates.get(selected.annictWorkId)}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>
      </View>

      {/* 曖昧マッチの候補リスト */}
      {item.status === "candidates" && (
        <View className="mt-2 ml-9 gap-1">
          {item.candidates.map((c) => {
            const isSelected = selected?.annictWorkId === c.annictWorkId;
            return (
              <TouchableOpacity
                key={c.annictWorkId}
                onPress={() => onSelectCandidate(index, c)}
                className={`flex-row items-center gap-2 rounded-lg border px-2 py-1.5 ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white"
                }`}
                accessibilityRole="button"
                accessibilityLabel={`候補: ${c.title}`}
              >
                <WorkThumbnail item={c} width={24} height={32} />
                <Text
                  className="flex-1 text-xs text-gray-700"
                  numberOfLines={2}
                >
                  {c.title}
                  {c.seasonYear ? `（${c.seasonYear}年）` : ""}
                </Text>
                {isSelected && (
                  <Text className="text-xs text-indigo-600 font-bold">
                    選択中
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}
