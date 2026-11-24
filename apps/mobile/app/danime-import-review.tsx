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
// 確定後は API 上限件数ずつ /me/watch-histories/bulk に送り、
// 進捗と失敗を表示する。
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
import { useDanimeImportEnabled } from "@/lib/featureFlags/useDanimeImportEnabled";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import {
  useBulkRegisterWatchHistory,
  useCreateDanimeEpisodeJob,
  useDanimeMatch,
} from "@/lib/danime/useDanimeImport";
import { danimeMatchErrorMessage } from "@/lib/danime/matchErrorMessage";
import { DanimeEpisodeJobStatus } from "@/components/danime/EpisodeJobStatus";
import type {
  BulkRegisterEntry,
  BulkRegisterResult,
  DanimeEpisodeJobWorkInput,
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
import Ionicons from "@expo/vector-icons/Ionicons";
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
  requestError: TranslationKey | null;
  requestErrorStatus: number | null;
  /** 登録フェーズの経過時間（ms、クライアント側計測）。 */
  elapsedMs: number;
  /**
   * 話記録ジョブ（issue #477）の登録結果。
   * null = 対象の話データが無く登録しなかった。true/false は
   * サーバーがジョブを新規作成したか（false = 実行中ジョブが既にあり、
   * 今回の話はキューされなかった）。
   */
  episodeJobCreated: boolean | null;
};

// フェーズ所要時間の可視化（issue #115）。抽出は抽出スクリプトが payload に
// 載せ、照合/登録はクライアント側で計測する。
type MatchTiming = {
  elapsedMs: number;
  stats?: DanimeMatchStats | undefined;
};

function formatSec(ms: number, t: TFunction): string {
  return t("{{seconds}}秒", { seconds: (ms / 1000).toFixed(1) });
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
    case "apply":
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
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const lists = useDanimeImportStore((s) => s.lists);
  const setLists = useDanimeImportStore((s) => s.setLists);
  const danimeImportEnabled = useDanimeImportEnabled();

  const match = useDanimeMatch();
  const bulk = useBulkRegisterWatchHistory();
  const episodeJob = useCreateDanimeEpisodeJob();
  // isLoading はクエリ無効化（Annict 未連携）時も false になるため、
  // 「ロード完了 or 無効 or 失敗」= !isLoading を待機条件に使う。
  const { data: histories, isLoading: isHistoriesLoading } = useWatchHistory();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [episodeJobPending, setEpisodeJobPending] = useState(false);
  const [matchTiming, setMatchTiming] = useState<MatchTiming | null>(null);
  const startedRef = useRef(false);

  // 照合対象の作品数（照合中の進捗表示用）。
  const workCount = lists ? toMatchWorks(lists).length : 0;
  const matchingActive =
    rows === null && (match.isPending || isHistoriesLoading);
  const matchElapsedSec = useElapsedSeconds(matchingActive);
  const registerElapsedSec = useElapsedSeconds(progress !== null);

  // 履歴が届いていない（クエリ失敗・未連携）なら既存ステータスは不明として扱う。
  const historyUnknown = histories === undefined;

  // 既存ステータスの索引（ダウングレード防止用）。
  // kept renderRow の依存なので参照を固定する。
  const currentStates = useMemo(() => {
    const m = new Map<number, string>();
    for (const h of histories ?? []) m.set(h.annictWorkId, h.state);
    return m;
  }, [histories]);

  // 照合 API に渡す登録済み作品 ID（別シーズン候補の除外ヒント）。
  // 照合 effect の依存なので参照を固定する。
  const registeredWorkIds = useMemo(
    () => (histories ?? []).map((h) => h.annictWorkId),
    [histories],
  );

  const buildRows = (results: DanimeMatchItem[]): Row[] => {
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
  };

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

  // kept renderRow の依存なので参照を固定する。
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

  // kept renderRow の依存なので参照を固定する。
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

  // FlatList の renderItem は行の再描画を抑えるため参照を固定する。
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

  // フラグ無効時（#751 の env 切り戻し）・停止スイッチ（#758）中は、
  // 直接遷移されてもホームへ戻す。
  if (!danimeImportEnabled) {
    return <Redirect href="/(tabs)/library?section=history" />;
  }

  if (!lists) {
    // ストアが空 = 取込画面を経ずに来た → 取込画面へ戻す。
    return <Redirect href="/danime-import" />;
  }

  const checkedCount = rows?.filter((r) => r.checked && r.selected).length ?? 0;
  // same_state（Annict に同じ状態で登録済み）は作品登録の既定チェックが
  // 外れているが、話の記録は対象にする。チェック済み作品だけだと
  // Annict 利用者の大半の話がジョブに載らない（issue #691）。
  // ユーザーが既定チェックを自分で外した作品は checked/note とも対象外のまま。
  const episodeWorks: DanimeEpisodeJobWorkInput[] = (rows ?? [])
    .filter(
      (r) =>
        r.item.status === "exact" &&
        r.selected &&
        (r.checked || r.locked || r.note?.kind === "same_state"),
    )
    .map((r) => ({
      danimeWorkId: r.item.danimeWorkId,
      annictWorkId: r.selected!.annictWorkId,
      episodes: lists.episodes?.[r.item.danimeWorkId] ?? [],
    }))
    .filter((w) => w.episodes.some((e) => e.watched));
  const episodeCount = episodeWorks.reduce(
    (count, work) => count + work.episodes.filter((e) => e.watched).length,
    0,
  );

  async function finishRegistration(
    res: BulkRegisterResult,
    attemptedIds: Set<number>,
  ) {
    const okWorkIds = new Set(
      res.results.filter((r) => r.ok).map((r) => r.annictWorkId),
    );
    const eligibleWorks = episodeWorks.filter(
      (w) => !attemptedIds.has(w.annictWorkId) || okWorkIds.has(w.annictWorkId),
    );
    let episodeJobCreated: boolean | null = null;
    if (eligibleWorks.length > 0) {
      setEpisodeJobPending(true);
      try {
        const out = await episodeJob.mutateAsync({ works: eligibleWorks });
        episodeJobCreated = out.created;
      } catch {
        // ジョブ登録の失敗は作品登録の成功を巻き戻さない。
        // null のまま残し、結果画面では話記録を表示しない。
      }
      setEpisodeJobPending(false);
    }
    const succeeded = res.results.filter((r) => r.ok).length;
    const failed = res.results.filter((r) => !r.ok).length;
    // オンボーディングの完了率（issue #758）。結果画面に到達した時点を完了とする。
    trackEvent("danime_import_complete", {
      [TRACK_EVENT_KEYS.succeeded]: String(succeeded),
      [TRACK_EVENT_KEYS.failed]: String(failed),
    });
    setDoneResult({
      succeeded,
      failed,
      aborted: res.aborted,
      requestError: res.requestError,
      requestErrorStatus: res.requestErrorStatus,
      elapsedMs: res.elapsedMs,
      episodeJobCreated,
    });
  }

  function register() {
    if (!rows || progress !== null || episodeJobPending) return;
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
    if (entries.length === 0) {
      if (episodeWorks.length > 0) {
        void finishRegistration(
          {
            results: [],
            aborted: false,
            requestError: null,
            requestErrorStatus: null,
            elapsedMs: 0,
          },
          new Set(),
        );
      }
      return;
    }
    setProgress({ done: 0, total: entries.length });
    bulk.mutate(
      {
        entries,
        onProgress: (done, total) => setProgress({ done, total }),
      },
      {
        onSuccess: (res) => {
          void finishRegistration(
            res,
            new Set(entries.map((entry) => entry.annictWorkId)),
          );
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
      parts.push(
        t("抽出: {{duration}}", {
          duration: formatSec(lists.extractElapsedMs, t),
        }),
      );
    }
    if (matchTiming) {
      const s = matchTiming.stats;
      const searches = s ? s.firstPassSearches + s.secondPassSearches : 0;
      parts.push(
        t("照合: {{duration}}", {
          duration: formatSec(matchTiming.elapsedMs, t),
        }) +
          (s
            ? `（${t("Annict 検索 {{count}} 回", { count: searches })}${s.retries > 0 ? `・${t("リトライ {{count}} 回", { count: s.retries })}` : ""}）`
            : ""),
      );
    }
    if (doneResult) {
      parts.push(
        t("登録: {{duration}}", {
          duration: formatSec(doneResult.elapsedMs, t),
        }),
      );
    }
    return parts.join(" / ");
  })();

  // ---- 結果画面 ----
  if (doneResult) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-slate-900 items-center justify-center px-8">
        <Text className="text-lg font-bold text-foreground">
          {t("登録結果")}
        </Text>
        <Text className="text-sm text-secondary mt-3 text-center">
          {t("成功: {{succeeded}} 件 / 失敗・未処理: {{failed}} 件", {
            succeeded: doneResult.succeeded,
            failed: doneResult.failed,
          })}
        </Text>
        {timingSummary !== "" && (
          <Text className="text-[11px] text-muted mt-2 text-center">
            {timingSummary}
          </Text>
        )}
        {doneResult.aborted && (
          <Text className="text-xs text-danger mt-2 text-center">
            {t(
              "Annict 連携が切れたため途中で中断されました。連携を確認して再度お試しください。",
            )}
          </Text>
        )}
        {doneResult.requestError && (
          <Text className="text-xs text-danger mt-2 text-center">
            {t(doneResult.requestError, {
              status: doneResult.requestErrorStatus,
            })}
          </Text>
        )}
        {doneResult.episodeJobCreated === true && (
          <View className="mt-4 self-stretch">
            <DanimeEpisodeJobStatus />
          </View>
        )}
        {doneResult.episodeJobCreated === false && (
          <Text className="text-xs text-amber-700 dark:text-amber-300 mt-3 text-center">
            {t(
              "実行中の話数記録ジョブがあるため、今回の話数は登録されませんでした。完了後にもう一度お試しください。",
            )}
          </Text>
        )}
        <TouchableOpacity
          className="mt-6 bg-indigo-600 rounded-xl px-8 py-3"
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t("視聴履歴へ戻る")}
        >
          <Text className="text-white font-semibold">
            {t("視聴履歴へ戻る")}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ---- マッチング中 ----
  if (rows === null && (match.isPending || isHistoriesLoading)) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-slate-900 items-center justify-center px-8">
        <ActivityIndicator size="large" color={colors.primaryText} />
        <Text className="text-sm text-muted mt-4">
          {t("Annict の作品と照合しています…")}
        </Text>
        <Text className="text-[11px] text-muted mt-2">
          {t("{{count}} 件 / {{seconds}} 秒経過", {
            count: workCount,
            seconds: matchElapsedSec,
          })}
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
          accessibilityLabel={t("戻る")}
        />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-sm text-danger text-center">
            {t(danimeMatchErrorMessage(match.error) as TranslationKey)}
          </Text>
          <TouchableOpacity
            className="mt-4 bg-indigo-600 rounded-xl px-8 py-3"
            onPress={retryMatch}
            accessibilityRole="button"
            accessibilityLabel={t("再試行")}
          >
            <Text className="text-white font-semibold">{t("再試行")}</Text>
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
      <View className="px-4 pb-3 border-b border-slate-100 dark:border-slate-800">
        <BackButton
          className="-ml-2 self-start"
          onPress={() => router.back()}
          accessibilityLabel={t("戻る")}
        />
        <Text className="text-xl font-bold text-foreground">
          {t("インポート内容の確認")}
        </Text>
        <Text className="text-xs text-muted mt-1">
          {t("{{total}} 件中 {{selected}} 件を登録します", {
            selected: checkedCount,
            total: rows.length,
          })}
        </Text>
        {episodeCount > 0 && (
          <Text className="text-xs text-muted mt-1">
            {t(
              "視聴済み {{episodes}} 話のうち、対応付けできた話を Annict に記録します",
              {
                episodes: episodeCount,
              },
            )}
          </Text>
        )}
        {timingSummary !== "" && (
          <Text className="text-[10px] text-muted mt-0.5">{timingSummary}</Text>
        )}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.item.danimeWorkId}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        renderItem={renderRow}
      />

      <View className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
        {progress !== null && (
          <Text className="text-xs text-muted text-center mb-2">
            {t("登録中… {{done}} / {{total}}（{{seconds}} 秒経過）", {
              done: progress.done,
              total: progress.total,
              seconds: registerElapsedSec,
            })}
          </Text>
        )}
        {bulk.isError && (
          <Text className="text-xs text-danger text-center mb-2">
            {t(bulk.error.message, { defaultValue: bulk.error.message })}
          </Text>
        )}
        <TouchableOpacity
          className={`rounded-xl py-3 items-center ${
            (checkedCount > 0 || episodeWorks.length > 0) &&
            progress === null &&
            !episodeJobPending
              ? "bg-indigo-600"
              : "bg-slate-300 dark:bg-slate-700"
          }`}
          onPress={register}
          disabled={
            (checkedCount === 0 && episodeWorks.length === 0) ||
            progress !== null ||
            episodeJobPending
          }
          accessibilityRole="button"
          accessibilityLabel={t("Annict に登録")}
          testID="danime-register-button"
        >
          {progress !== null || episodeJobPending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text
              className={`font-semibold ${
                (checkedCount > 0 || episodeWorks.length > 0) &&
                progress === null &&
                !episodeJobPending
                  ? "text-white"
                  : "text-foreground"
              }`}
            >
              {episodeCount > 0
                ? t("Annict に登録")
                : t("{{count}} 件を Annict に登録", { count: checkedCount })}
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
  const { t } = useTranslation();
  const { item, selected, checked, locked, note } = row;
  const colors = useThemeColors();
  const stateLabel = t(item.targetState === "WATCHED" ? "視聴済" : "視聴中");
  const stateColor =
    item.targetState === "WATCHED" ? colors.success : colors.primaryText;

  return (
    <View className="py-3 border-b border-slate-100 dark:border-slate-800">
      <View className="flex-row items-center gap-3">
        <TouchableOpacity
          onPress={() => onToggle(index)}
          disabled={!selected || locked}
          className={`w-6 h-6 rounded-md border items-center justify-center ${
            checked && selected
              ? "bg-indigo-600 border-indigo-600"
              : "border-slate-300 dark:border-slate-600"
          }`}
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: checked && !!selected,
            disabled: !selected || locked,
          }}
          accessibilityLabel={t("{{title}} を登録対象にする", {
            title: item.title,
          })}
        >
          {checked && selected !== null && (
            <Ionicons name="checkmark" size={14} color="#ffffff" />
          )}
        </TouchableOpacity>

        <View className="flex-1">
          <Text className="text-foreground font-medium" numberOfLines={2}>
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
        {t("{{status}}に登録", { status: targetLabel })}
      </Text>
      {status === "exact" && selected !== null && (
        <Text className="text-xs text-success">{t("自動マッチ")}</Text>
      )}
      {status === "none" && (
        <Text className="text-xs text-muted">
          {t("Annict に一致する作品が見つかりません（スキップ）")}
        </Text>
      )}
      {status === "pending" && (
        <Text className="text-xs text-muted">
          {t("照合を完了できませんでした（スキップ）")}
        </Text>
      )}
      {note !== null && (
        <Text className="text-xs text-amber-700 dark:text-amber-300">
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
  const { t } = useTranslation();
  const stateLabel = currentState ? statusLabel(currentState, t) : null;

  return (
    <View className="flex-row items-center gap-2 mt-2">
      {/* 照合候補は Annict から直接引いた作品で画像プロキシの URL を持たないため、
          Annict の画像をそのまま出す。 */}
      <WorkThumbnail
        uri={work.imageUrl}
        title={work.title}
        width={32}
        height={42}
      />
      <View className="flex-1">
        <Text className="text-xs text-secondary" numberOfLines={2}>
          → {work.title}
        </Text>
        {stateLabel !== null && (
          <Text className="text-[10px] text-muted">
            {t("現在: {{status}}", { status: stateLabel })}
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
  const { t } = useTranslation();
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
                : "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
            }`}
            accessibilityRole="button"
            accessibilityLabel={t("候補: {{title}}", { title: c.title })}
          >
            <WorkThumbnail
              uri={c.imageUrl}
              title={c.title}
              width={24}
              height={32}
            />
            <Text className="flex-1 text-xs text-secondary" numberOfLines={2}>
              {c.title}
              {c.seasonYear ? ` (${c.seasonYear})` : ""}
            </Text>
            {isSelected && (
              <Text className="text-xs text-primary-text font-bold">
                {t("選択中")}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
