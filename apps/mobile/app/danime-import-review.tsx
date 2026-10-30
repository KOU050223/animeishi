// dアニメインポートのレビュー画面（ハイブリッド方式）。
//
//   - exact（高確度一致）: 既定でチェック ON
//   - candidates（曖昧）: ユーザーが候補から選ぶまで未チェック
//   - none（未マッチ）: スキップ表示
// さらに Annict 上の現在ステータスと突き合わせ（decideDanimeImport）、
//   - 同じステータスが既に登録済み → 既定で除外（再登録しても意味がない）
//   - 視聴済・一時停止・断念の作品 → 選択自体を無効化して理由を表示する
//     （issue #374。取り込みでユーザーの明示的なステータスを戻さない）
//   - 履歴が未取得のまま照合が終わっても安全に扱うため、照合は履歴クエリの
//     完了を待ってから実行し、取得失敗時は WATCHING 対象を既定で保留にする
// 確定後は 50 件ずつ /me/watch-histories/bulk に送り、進捗と失敗を表示する。
// API 側も同じ判定で保護対象を弾くため、ここでの制御は案内が主目的。
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
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useDanimeImportStore } from "@/store/danimeImportStore";
import { featureFlags } from "@/lib/featureFlags";
import {
  useBulkRegisterWatchHistory,
  useDanimeMatch,
} from "@/lib/danime/useDanimeImport";
import { danimeMatchErrorMessage } from "@/lib/danime/matchErrorMessage";
import type {
  BulkRegisterEntry,
  DanimeMatchStats,
} from "@/lib/danime/useDanimeImport";
import {
  decideDanimeImport,
  toMatchWorks,
  type DanimeAnnictWork,
  type DanimeMatchItem,
} from "@animeishi/danime-core";
import { useWatchHistory, WATCH_STATUS_LABELS } from "@/lib/useWatchHistory";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { TranslationKey } from "@/lib/i18n/keys";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { BackButton } from "@/components/ui";
import { useThemeColors } from "@/lib/theme";

// 行に出す「登録しない理由」。表示文言（i18n）への変換は描画側で行う。
type RowNote =
  | { kind: "same_state" | "protected_state"; state: string }
  | { kind: "current_state_unknown" | "watched_duplicate" };

type Row = {
  item: DanimeMatchItem;
  /** 登録対象として選ばれている Annict 作品。null なら登録不可。 */
  selected: DanimeAnnictWork | null;
  checked: boolean;
  /** true なら取り込みで変更しない作品（保護対象）。チェック不可。 */
  locked: boolean;
  /** 「登録済みのため除外」などの注記。 */
  note: RowNote | null;
};

type DoneResult = {
  succeeded: number;
  failed: number;
  aborted: boolean;
  requestError: string | null;
  /** 登録フェーズの経過時間（ms、クライアント側計測）。 */
  elapsedMs: number;
};

// フェーズ所要時間の可視化（issue #115）。抽出は抽出スクリプトが payload に
// 載せ、照合/登録はクライアント側で計測する。
type MatchTiming = {
  elapsedMs: number;
  stats?: DanimeMatchStats;
};

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}秒`;
}

// active の間だけ経過秒数を 0.5 秒刻みで返す（照合中・登録中の表示用）。
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  // active が立ち上がったら計測を 0 に戻す。effect での同期 setState を
  // 避けるため、前回値との比較でレンダー中にリセットする。
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    setSeconds(0);
  }
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      500,
    );
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}

// Annict の現在ステータスと突き合わせて既定の checked / locked / note を決める。
// 判定自体は API 側とも共有する danime-core の decideDanimeImport に集約する。
// currentState が undefined（履歴クエリ失敗・未取得）のときは WATCHING 登録を
// 降格させ得るため既定で保留にする。WATCHED 登録は降格になり得ないので許可する。
function initialRowState(
  item: DanimeMatchItem,
  selected: DanimeAnnictWork | null,
  currentState: string | null | undefined,
): Pick<Row, "checked" | "locked" | "note"> {
  if (!selected) return { checked: false, locked: false, note: null };
  switch (decideDanimeImport(item.targetState, currentState)) {
    case "current_state_unknown":
      return {
        checked: false,
        locked: false,
        note: { kind: "current_state_unknown" },
      };
    case "same_state":
      return {
        checked: false,
        locked: false,
        note: { kind: "same_state", state: item.targetState },
      };
    case "protected_state":
      // ユーザーが明示的に付けた最終状態なので、取り込みでは
      // チェック自体を付けられない（issue #374）。
      return {
        checked: false,
        locked: true,
        // protected_state が返るのは currentState が保護対象の値のときだけ。
        note: { kind: "protected_state", state: currentState! },
      };
    default:
      return { checked: true, locked: false, note: null };
  }
}

// Annict ステータス値 → i18n キー経由の表示名。未知の値はそのまま出す。
function statusLabel(state: string, t: TFunction): string {
  const key = WATCH_STATUS_LABELS[state as keyof typeof WATCH_STATUS_LABELS] as
    | TranslationKey
    | undefined;
  return key ? t(key) : state;
}

function noteText(note: RowNote, t: TFunction): string {
  switch (note.kind) {
    case "same_state":
      return t("Annict で「{{state}}」登録済み", {
        state: statusLabel(note.state, t),
      });
    case "protected_state":
      return t("Annict で「{{state}}」のため変更しません", {
        state: statusLabel(note.state, t),
      });
    case "current_state_unknown":
      return t("Annict の現在ステータスを取得できなかったため保留");
    case "watched_duplicate":
      return t("同じ作品が視聴済みでも登録予定のため除外");
  }
}

export default function DanimeImportReviewScreen() {
  const router = useRouter();
  const colors = useThemeColors();
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
  const [matchTiming, setMatchTiming] = useState<MatchTiming | null>(null);
  const startedRef = useRef(false);

  // 照合対象の作品数（照合中の進捗表示用）。
  const workCount = useMemo(
    () => (lists ? toMatchWorks(lists).length : 0),
    [lists],
  );
  const matchingActive =
    rows === null && (match.isPending || isHistoriesLoading);
  const matchElapsedSec = useElapsedSeconds(matchingActive);
  const registerElapsedSec = useElapsedSeconds(progress !== null);

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
        const state = initialRowState(
          item,
          selected,
          selected
            ? historyUnknown
              ? undefined
              : (currentStates.get(selected.annictWorkId) ?? null)
            : undefined,
        );
        return { item, selected, ...state };
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
              note: { kind: "watched_duplicate" as const },
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
        onSuccess: (out) => {
          setMatchTiming({ elapsedMs: out.elapsedMs, stats: out.stats });
          setRows(buildRows(out.items));
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, isHistoriesLoading, registeredWorkIds]);

  const toggleRow = useCallback((index: number) => {
    setRows(
      (prev) =>
        prev?.map((r, i) =>
          i === index && r.selected && !r.locked
            ? { ...r, checked: !r.checked }
            : r,
        ) ?? null,
    );
  }, []);

  const selectCandidate = useCallback(
    (rowIndex: number, work: DanimeAnnictWork) => {
      setRows(
        (prev) =>
          prev?.map((r, i) => {
            if (i !== rowIndex) return r;
            const { note, locked } = initialRowState(
              r.item,
              work,
              historyUnknown
                ? undefined
                : (currentStates.get(work.annictWorkId) ?? null),
            );
            // 候補選択は「登録したい」意思表示なのでチェック ON にする。
            // ダウングレード等の注意は note として残す。ただし保護対象
            // （視聴済・一時停止・断念）は登録に回せないのでチェックしない。
            return { ...r, selected: work, checked: !locked, locked, note };
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

  // v1.0 ではネイティブで無効化（#158）。直接遷移されてもホームへ戻す。
  if (!featureFlags.danimeImport) {
    return <Redirect href="/(tabs)/library?section=history" />;
  }

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
            elapsedMs: res.elapsedMs,
          });
        },
        onSettled: () => setProgress(null),
      },
    );
  }

  function close() {
    setLists(null);
    router.replace("/(tabs)/library?section=history");
  }

  function retryMatch() {
    match.reset();
    match.mutate(
      { lists: lists!, registeredWorkIds },
      {
        onSuccess: (out) => {
          setMatchTiming({ elapsedMs: out.elapsedMs, stats: out.stats });
          setRows(buildRows(out.items));
        },
      },
    );
  }

  // 「抽出 X秒 / 照合 Y秒（検索 N回）」形式のフェーズ所要時間サマリ。
  // 取れている分だけ連結する（抽出時間は旧 payload / 手動貼り付けで欠け得る）。
  const timingSummary = (() => {
    const parts: string[] = [];
    if (lists?.extractElapsedMs != null) {
      parts.push(`抽出 ${formatSec(lists.extractElapsedMs)}`);
    }
    if (matchTiming) {
      const s = matchTiming.stats;
      const searches = s ? s.firstPassSearches + s.secondPassSearches : 0;
      parts.push(
        `照合 ${formatSec(matchTiming.elapsedMs)}` +
          (s
            ? `（Annict 検索 ${searches} 回${s.retries > 0 ? `・リトライ ${s.retries} 回` : ""}）`
            : ""),
      );
    }
    if (doneResult) {
      parts.push(`登録 ${formatSec(doneResult.elapsedMs)}`);
    }
    return parts.join(" / ");
  })();

  // ---- 結果画面 ----
  if (doneResult) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-slate-900 items-center justify-center px-8">
        <Text className="text-lg font-bold text-gray-900 dark:text-slate-100">
          登録結果
        </Text>
        <Text className="text-sm text-gray-600 dark:text-slate-300 mt-3 text-center">
          成功: {doneResult.succeeded} 件 / 失敗・未処理: {doneResult.failed} 件
        </Text>
        {timingSummary !== "" && (
          <Text className="text-[11px] text-gray-400 dark:text-slate-500 mt-2 text-center">
            {timingSummary}
          </Text>
        )}
        {doneResult.aborted && (
          <Text className="text-xs text-red-500 dark:text-red-400 mt-2 text-center">
            Annict
            連携が切れたため途中で中断されました。連携を確認して再度お試しください。
          </Text>
        )}
        {doneResult.requestError && (
          <Text className="text-xs text-red-500 dark:text-red-400 mt-2 text-center">
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

  // ---- マッチング中 ----
  if (rows === null && (match.isPending || isHistoriesLoading)) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-slate-900 items-center justify-center px-8">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-sm text-gray-500 dark:text-slate-400 mt-4">
          Annict の作品と照合しています…
        </Text>
        <Text className="text-[11px] text-gray-400 dark:text-slate-500 mt-2">
          {workCount} 件 / {matchElapsedSec} 秒経過
        </Text>
      </SafeAreaView>
    );
  }

  // ---- 照合失敗 ----
  // エラー文言は code ごとのユーザー向け案内に変換する（API のエラー JSON を
  // そのまま出さない。詳細は useDanimeMatch がコンソールに残す）。
  // BackButton は他の画面と同じく左上のヘッダー位置（issue #219）。
  if (rows === null) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["top", "bottom"]}
      >
        <BackButton
          className="ml-2 self-start"
          onPress={() => router.back()}
          accessibilityLabel="戻る"
        />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-sm text-red-500 dark:text-red-400 text-center">
            {danimeMatchErrorMessage(match.error)}
          </Text>
          <TouchableOpacity
            className="mt-4 bg-indigo-600 rounded-xl px-8 py-3"
            onPress={retryMatch}
            accessibilityRole="button"
            accessibilityLabel="再試行"
          >
            <Text className="text-white font-semibold">再試行</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---- レビュー一覧 ----
  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <View className="px-4 pb-3 border-b border-gray-100 dark:border-slate-800">
        <BackButton
          className="-ml-2 self-start"
          onPress={() => router.back()}
          accessibilityLabel="戻る"
        />
        <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
          インポート内容の確認
        </Text>
        <Text className="text-xs text-gray-500 dark:text-slate-400 mt-1">
          {rows.length} 件中 {checkedCount} 件を登録します
        </Text>
        {timingSummary !== "" && (
          <Text className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">
            {timingSummary}
          </Text>
        )}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.item.danimeWorkId}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        renderItem={renderRow}
      />

      <View className="px-4 py-3 border-t border-gray-100 dark:border-slate-800">
        {progress !== null && (
          <Text className="text-xs text-gray-500 dark:text-slate-400 text-center mb-2">
            登録中… {progress.done} / {progress.total}（{registerElapsedSec}{" "}
            秒経過）
          </Text>
        )}
        {bulk.isError && (
          <Text className="text-xs text-red-500 dark:text-red-400 text-center mb-2">
            {bulk.error.message}
          </Text>
        )}
        <TouchableOpacity
          className={`rounded-xl py-3 items-center ${
            checkedCount > 0 && !bulk.isPending
              ? "bg-indigo-600"
              : "bg-gray-300 dark:bg-slate-700"
          }`}
          onPress={register}
          disabled={checkedCount === 0 || bulk.isPending}
          accessibilityRole="button"
          accessibilityLabel="Annict に登録"
          testID="danime-register-button"
        >
          {bulk.isPending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text className="text-white font-semibold">
              {checkedCount} 件を Annict に登録
            </Text>
          )}
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
  const { item, selected, checked, locked, note } = row;
  const colors = useThemeColors();
  const stateLabel = item.targetState === "WATCHED" ? "視聴済" : "視聴中";
  const stateColor =
    item.targetState === "WATCHED" ? colors.success : colors.primaryText;

  return (
    <View className="py-3 border-b border-gray-100 dark:border-slate-800">
      <View className="flex-row items-center gap-3">
        <TouchableOpacity
          onPress={() => onToggle(index)}
          disabled={!selected || locked}
          className={`w-6 h-6 rounded-md border items-center justify-center ${
            checked && selected
              ? "bg-indigo-600 border-indigo-600"
              : "border-gray-300 dark:border-slate-600"
          }`}
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: checked && !!selected,
            disabled: !selected || locked,
          }}
          accessibilityLabel={`${item.title} を登録対象にする`}
        >
          {checked && selected !== null && (
            <Text className="text-white text-xs font-bold">✓</Text>
          )}
        </TouchableOpacity>

        <View className="flex-1">
          <Text
            className="text-gray-900 dark:text-slate-100 font-medium"
            numberOfLines={2}
          >
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
  note: RowNote | null;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-2 mt-1 flex-wrap">
      <Text
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ color: targetColor, backgroundColor: `${targetColor}20` }}
      >
        {targetLabel}に登録
      </Text>
      {status === "exact" && selected !== null && (
        <Text className="text-xs text-green-600 dark:text-green-400">
          自動マッチ
        </Text>
      )}
      {status === "none" && (
        <Text className="text-xs text-gray-400 dark:text-slate-500">
          Annict に一致する作品が見つかりません（スキップ）
        </Text>
      )}
      {status === "pending" && (
        <Text className="text-xs text-gray-400 dark:text-slate-500">
          照合を完了できませんでした（スキップ）
        </Text>
      )}
      {note !== null && (
        <Text className="text-xs text-amber-600 dark:text-amber-400">
          {noteText(note, t)}
        </Text>
      )}
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
      {/* 照合候補は Annict から直接引いた作品で画像プロキシの URL を持たないため、
          Annict の画像をそのまま出す。 */}
      <WorkThumbnail uri={work.imageUrl} width={32} height={42} />
      <View className="flex-1">
        <Text
          className="text-xs text-gray-600 dark:text-slate-300"
          numberOfLines={2}
        >
          → {work.title}
        </Text>
        {stateLabel !== null && (
          <Text className="text-[10px] text-gray-400 dark:text-slate-500">
            現在: {stateLabel}
          </Text>
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
                ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                : "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800"
            }`}
            accessibilityRole="button"
            accessibilityLabel={`候補: ${c.title}`}
          >
            <WorkThumbnail uri={c.imageUrl} width={24} height={32} />
            <Text
              className="flex-1 text-xs text-gray-700 dark:text-slate-200"
              numberOfLines={2}
            >
              {c.title}
              {c.seasonYear ? `（${c.seasonYear}年）` : ""}
            </Text>
            {isSelected && (
              <Text className="text-xs text-indigo-600 dark:text-indigo-300 font-bold">
                選択中
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
