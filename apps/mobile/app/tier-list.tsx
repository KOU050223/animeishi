import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
  type ViewInstance,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { webUrl } from "@/lib/webUrl";
import { alert, confirm } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { haptics } from "@/lib/haptics";
import { useWorkCatalogAccess } from "@/lib/annict";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { BackButton, Input } from "@/components/ui";
import { SeasonFilter } from "@/components/anime-list/SeasonFilter";
import {
  adjacentSeasonParams,
  currentSeason,
  parseSeasonParam,
  toSeasonParam,
  type SeasonKey,
} from "@/components/anime-list/animeListUtils";
import { TierBoard } from "@/components/tier-list/TierBoard";
import { useOpenWorkDetail } from "@/lib/workDetailContext";
import {
  TierBoardSnapshot,
  type SnapshotItem,
} from "@/components/tier-list/TierBoardSnapshot";
import { TierListMetaFields } from "@/components/tier-list/TierListMetaFields";
import { useTierListStyles } from "@/components/tier-list/tierListStyles";
import { useThemeColors } from "@/lib/theme";
import {
  assignItem,
  mergeBoardItems,
  parseTiersJson,
  toAssignment,
  toSaveItems,
} from "@/lib/tierList/board";
import {
  DEFAULT_TIERS,
  defaultCharacterTierListTitle,
  defaultTierListTitle,
} from "@/lib/tierList/defaults";
import { renameTier } from "@/lib/tierList/label";
import {
  buildTierListShareUrl,
  captureTierListImageFile,
  presentTierShareOptions,
  shareTierListImage,
  useTierUrlShare,
} from "@/lib/tierList/share";
// jest が "@/lib/tierList/share" をモックするため、フロー本体は
// バレル経由ではなくサブモジュールから直接 import する。
import {
  shareTierListViaUrl,
  withRenderedTierSnapshot,
} from "@/lib/tierList/share/flow";
import type { TierAssignment, TierItem, TierRow } from "@/lib/tierList/types";
import type { TierListKind } from "@/lib/tierList/useMergedTierLists";
import type { TierListScope } from "@/lib/queries/tierLists";
import { useSeasonWorks } from "@/lib/tierList/useSeasonWorks";
import { useWorkCharacters } from "@/lib/tierList/useWorkCharacters";
import { useWorksLookup } from "@/lib/tierList/useWorksLookup";
import { usePrefetchSeasonWorks } from "@/lib/useAnimeList";
import {
  useSavedTierList,
  useSaveTierList,
  useShareTierList,
} from "@/lib/tierList/useTierList";

/**
 * tier 表の編集画面（issue #724 で season / character / custom の 3 画面を
 * 1 つに統合）。kind ごとの違いは「候補の出し方」と保存スコープだけ:
 * - season   : そのシーズンの作品 − 配置済み（未分類トレイ）。シーズン切替あり。
 * - character: その作品のキャスト − 配置済み（未分類トレイ）。対象作品は固定。
 * - custom   : 検索して足す。未配置のまま閉じると消える（従来の挙動）。
 *
 * ルートパラメータ:
 * - `kind`      : season / character / custom（既定 season）。
 * - `season`    : season 用。保存済みのシーズンを直接開くときに渡す。
 * - `workId` / `workTitle`: character 用。対象作品（遷移元で確定）。
 * - `id`        : custom 用。既存の表を開く。無ければ新規作成。
 * - `workIds`   : custom 新規時の初期作品（issue #349 の引き継ぎ入口）。
 */

/** API のタイトル上限（tierListCreateSchema.max(50)）と揃える。 */
const TITLE_MAX_LENGTH = 50;

/** workIds パラメータ（カンマ区切り文字列）を正の整数 ID 配列に直す。 */
function parseWorkIdsParam(raw: string | undefined): number[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(ids)];
}

export default function TierListScreen() {
  const { t } = useTranslation();
  const openWork = useOpenWorkDetail();
  const router = useRouter();
  const styles = useTierListStyles();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{
    kind?: string;
    season?: string;
    workId?: string;
    workTitle?: string;
    id?: string;
    workIds?: string;
  }>();

  const kind: TierListKind =
    params.kind === "character" || params.kind === "custom"
      ? params.kind
      : "season";
  // testID の prefix は旧画面のものを踏襲する（E2E が参照するため）。
  const idPrefix =
    kind === "season" ? "tier-list" : (`${kind}-tier-list` as const);

  // --- kind ごとのスコープと対象の確定 ---

  // season: ?season= で保存済みのシーズンを直接開ける。無指定・不正値は今期。
  const initialSeason = parseSeasonParam(params.season) ?? currentSeason();
  const [year, setYear] = useState(initialSeason.year);
  const [seasonKey, setSeasonKey] = useState<SeasonKey>(initialSeason.key);
  const season = toSeasonParam(year, seasonKey);

  // character: 対象作品は遷移パラメータで確定する。
  const workIdParam = Number(params.workId);
  const validWorkId = Number.isFinite(workIdParam) && workIdParam > 0;

  // custom: 新規作成の最初の保存（POST）で id が確定する。以降の保存は
  // PUT に切り替わるよう、確定した id を画面状態として持つ。
  const idParam = params.id ? Number(params.id) : null;
  const [listId, setListId] = useState<number | null>(
    idParam !== null && Number.isFinite(idParam) && idParam > 0
      ? idParam
      : null,
  );

  // 保存対象を一意に決めるスコープ。custom の新規（id 未確定）は null で
  // 保存済み表のクエリを無効化する。
  const scope: TierListScope | null =
    kind === "season"
      ? { kind: "season", season }
      : kind === "character"
        ? validWorkId
          ? { kind: "character", annictWorkId: workIdParam }
          : null
        : listId !== null
          ? { kind: "custom", id: listId }
          : null;

  // --- 候補（kind ごとの「何を並べるか」） ---

  const { canBrowseWorks, isLoading: isAccessLoading } = useWorkCatalogAccess();
  const seasonWorks = useSeasonWorks(kind === "season" ? season : "");
  const workCharacters = useWorkCharacters(
    kind === "character" && validWorkId ? workIdParam : null,
  );
  // custom の #349 からの引き継ぎ作品。編集（id 指定）では既に保存 items に
  // 入っているので、新規作成時だけ初期トレイに並べる。
  const initialWorkIds =
    kind === "custom" && listId === null
      ? parseWorkIdsParam(params.workIds)
      : [];
  const lookup = useWorksLookup(initialWorkIds);
  const lookupWorks = useMemo<TierItem[]>(
    () =>
      (lookup.data?.works ?? []).map((w) => ({
        id: w.annictWorkId,
        title: w.title,
        imageUrl: w.hostedImageUrl,
      })),
    [lookup.data],
  );

  const {
    data: saved,
    isLoading: isSavedLoading,
    isError: isSavedError,
  } = useSavedTierList(scope);
  const save = useSaveTierList(scope);
  const share = useShareTierList(scope);

  // 前後シーズンを先読みしてシーズン切り替え直後の待ちを消す（issue #173）。
  usePrefetchSeasonWorks(
    adjacentSeasonParams(year, seasonKey),
    kind === "season" && canBrowseWorks && !seasonWorks.isLoading,
  );

  // 作品タイトルは「遷移パラメータ > API 応答」の順で使う（character）。
  const workTitle = params.workTitle ?? workCharacters.workTitle ?? null;

  // --- 盤面の状態 ---

  const [tiers, setTiers] = useState<TierRow[]>(DEFAULT_TIERS);
  const [assignment, setAssignment] = useState<TierAssignment>(new Map());
  // ＋ボタンの検索シートから手動追加した作品（issue #168）。
  // シーズン候補に載らない作品を未分類トレイへ並べるための追加枠。
  // 未配置のままでは保存対象にならずリロードで消えるので、シーズン切替時に
  // まとめてクリアする。
  const [manualWorks, setManualWorks] = useState<TierItem[]>([]);
  const [title, setTitle] = useState(() =>
    kind === "season"
      ? defaultTierListTitle(season)
      : kind === "character"
        ? defaultCharacterTierListTitle(workTitle)
        : "",
  );
  // 表の説明文と、ひろばの公開一覧に載せるか（issue #476）。
  // 共有 URL（share_token）とは独立した設定。
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  // 未保存の変更があるか。保存ボタンの活性と「保存済み」表示の出し分けに使う。
  const [isDirty, setIsDirty] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  // 画像エクスポート用。共有時だけ画面外にスナップショットを描画し、
  // キャプチャ後に null で取り除く。
  const [snapshotItems, setSnapshotItems] = useState<SnapshotItem[] | null>(
    null,
  );
  const snapshotRef = useRef<ViewInstance>(null);
  // 画像共有時に TierBoardSnapshot が全画像の読み込み（成功・失敗問わず）を
  // 終えた合図を受け取る。resolve はレンダー内の onReady から呼ぶので
  // ref 経由で promise に逃がす。
  const snapshotReadyRef = useRef<(() => void) | null>(null);
  // 保存データの組み立て元。保存は確認ダイアログや共有フローを挟むため、
  // ボタンを押した時点ではなく承認・実行の時点の盤面を送れるよう
  // 最新値を ref に逃がす（確認表示中の編集が古い配置で上書きされない）。
  const saveSourceRef = useRef({
    scope,
    listId,
    saved,
    title,
    description,
    isPublic,
    tiers,
    assignment,
  });
  useEffect(() => {
    saveSourceRef.current = {
      scope,
      listId,
      saved,
      title,
      description,
      isPublic,
      tiers,
      assignment,
    };
  });

  // --- 保存済みデータの hydrate ---
  // effect での同期 setState を避けるためレンダー中に調整する。
  // 編集中（isDirty）は上書きしない。保存後のキャッシュ更新や
  // バックグラウンド refetch で saved が変わっても、未保存の並べ替えを
  // 消さないため。スコープ自体が変わったときは常に反映する。
  // scope はレンダーごとに新しいオブジェクトになるため、参照ではなく
  // シリアライズした値で変化を判定する。
  const scopeKey = scope === null ? null : JSON.stringify(scope);
  const [hydrated, setHydrated] = useState<{
    scopeKey: string | null;
    saved: typeof saved;
  } | null>(null);
  if (
    !isSavedLoading &&
    (hydrated?.scopeKey !== scopeKey || (!isDirty && hydrated.saved !== saved))
  ) {
    setHydrated({ scopeKey, saved });
    if (saved) {
      setTiers(parseTiersJson(saved.tiersJson) ?? DEFAULT_TIERS);
      setAssignment(
        toAssignment(
          saved.items.map((i) => ({
            itemId: i.kind === "work" ? i.annictWorkId : i.annictCharacterId,
            tierKey: i.tierKey,
          })),
        ),
      );
      setTitle(saved.title);
      setDescription(saved.description ?? "");
      setIsPublic(saved.isPublic);
    } else {
      setTiers(DEFAULT_TIERS);
      setAssignment(new Map());
      setTitle(
        kind === "season"
          ? defaultTierListTitle(season)
          : kind === "character"
            ? defaultCharacterTierListTitle(workTitle)
            : "",
      );
      setDescription("");
      setIsPublic(false);
    }
    setIsDirty(false);
  }

  // character: 作品タイトルが遅れて届いた場合、既定タイトルだけを差し替える
  // （保存済みタイトルやユーザーが付けた名前は上書きしない）。
  const [titleSyncKey, setTitleSyncKey] = useState({ workTitle, saved });
  if (titleSyncKey.workTitle !== workTitle || titleSyncKey.saved !== saved) {
    setTitleSyncKey({ workTitle, saved });
    if (kind === "character" && workTitle && !saved) {
      setTitle((prev) =>
        prev === defaultCharacterTierListTitle(null)
          ? defaultCharacterTierListTitle(workTitle)
          : prev,
      );
    }
  }

  // --- 盤面に並べるアイテム集合 ---
  // - season   : シーズン候補（works）+ 保存済みのシーズン外作品 + 手動追加。
  //   保存済み items のうちシーズン外の作品は works だけではメタを引けず
  //   「配置済みなのに描画されない」状態になるため補完する。
  // - character: 作品のキャスト名簿そのまま。
  // - custom   : 保存済み items + 初期引き継ぎ作品 + 手動追加。
  // TierBoard の items prop（内部のジェスチャ依存チェーン）に渡すため参照を固定する。
  const savedBoardItems = useMemo<TierItem[]>(
    () =>
      (saved?.items ?? []).map((item) =>
        item.kind === "work"
          ? {
              id: item.annictWorkId,
              title: item.title,
              imageUrl: item.hostedImageUrl,
            }
          : { id: item.annictCharacterId, title: item.name, imageUrl: null },
      ),
    [saved],
  );
  const boardItems = useMemo<TierItem[]>(() => {
    if (kind === "character") return workCharacters.characters;
    if (kind === "custom")
      return mergeBoardItems(savedBoardItems, lookupWorks, manualWorks);
    return mergeBoardItems(seasonWorks.works, savedBoardItems, manualWorks);
  }, [
    kind,
    workCharacters.characters,
    savedBoardItems,
    lookupWorks,
    manualWorks,
    seasonWorks.works,
  ]);

  // --- 編集ハンドラ ---

  // TierBoard 内のドラッグ系コールバックの依存に入るため参照を固定する。
  const handleAssign = useCallback(
    (itemId: number, tierKey: string | null, beforeItemId?: number) => {
      // 共有・保存は「盤面を保存 → 応答を反映」を直列で行う。
      // その最中に編集が入ると、保存応答後の isDirty 解除や saved の再反映で
      // 処理中に行った編集が消えるため、リクエスト中のドロップは受け付けない。
      if (isSharing || save.isPending) return;
      setAssignment((prev) => assignItem(prev, itemId, tierKey, beforeItemId));
      setIsDirty(true);
    },
    [isSharing, save.isPending],
  );

  // 検索シートから選ばれた作品を未分類トレイへ追加する（season / custom）。
  // 追加だけでは保存 items に載らないため、配置までが一連の編集になる。
  const handleAddWork = (work: TierItem) => {
    if (isSharing || save.isPending) return;
    // 既に盤面にある作品（シーズン候補・保存済み・追加済み）は無視する。
    if (boardItems.some((w) => w.id === work.id)) return;
    // 作品の追加（issue #214）。重複・共有中の早期 return より後で送る。
    trackEvent("tier_work_add");
    setManualWorks((prev) => [...prev, work]);
    setIsDirty(true);
  };

  const handleChangeTitle = (next: string) => {
    // 読み込み中・取得失敗時の編集は受け付けない（handleChangeDescription と
    // 同じく、isDirty が立つと hydrate が止まり空の盤面を保存できてしまう）。
    if (isSharing || save.isPending || isSavedLoading || isSavedError) return;
    setTitle(next);
    setIsDirty(true);
  };

  const handleChangeDescription = (next: string) => {
    // ドロップと同じく、共有・保存中の編集は受け付けない。
    // 読み込み中・取得失敗時も不可（isDirty が立つと hydrate が走らず、
    // 空の盤面のまま既存配置を上書き保存できてしまうため）。
    if (isSharing || save.isPending || isSavedLoading || isSavedError) return;
    setDescription(next);
    setIsDirty(true);
  };

  const handleChangeIsPublic = (next: boolean) => {
    if (isSharing || save.isPending || isSavedLoading || isSavedError) return;
    setIsPublic(next);
    setIsDirty(true);
  };

  const handleRenameTier = (tierKey: string, label: string) => {
    // ドロップと同じく、共有・保存中の編集は受け付けない。
    // ここで tiers を変えると保存応答の反映で消えるため。
    if (isSharing || save.isPending) return;
    // trim 後に名前が変わっていない（or 存在しない key）なら差分なし。
    // renameTier が同じ配列を返すので、その場合は未保存扱いにしない。
    const next = renameTier(tiers, tierKey, label);
    if (next === tiers) return;
    setTiers(next);
    setIsDirty(true);
  };

  const handleBack = () => {
    const goBack = () => {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace(
        kind === "custom" ? "/tier-lists" : "/(tabs)/library?section=anime",
      );
    };

    // 保存はドロップごとではなく明示操作なので、未保存のまま離れると
    // 並べ替えが丸ごと消える。破棄する前に一度だけ確認する。
    if (isDirty) {
      confirm(
        t("保存していない変更があります"),
        t("このまま戻ると並べ替えた内容は失われます。"),
        goBack,
        {
          confirmLabel: t("破棄して戻る"),
          cancelLabel: t("編集を続ける"),
          destructive: true,
        },
      );
      return;
    }
    goBack();
  };

  // season: シーズンを変えると盤面を丸ごと差し替えるため、未保存の
  // 並べ替えは確認なしに消える。戻るときと同じく一度だけ確認する。
  const confirmIfDirty = (apply: () => void) => {
    if (!isDirty) {
      apply();
      return;
    }
    confirm(
      t("保存していない変更があります"),
      t("シーズンを切り替えると並べ替えた内容は失われます。"),
      apply,
      {
        confirmLabel: t("破棄して切り替える"),
        cancelLabel: t("編集を続ける"),
        destructive: true,
      },
    );
  };

  const handleChangeSeason = (nextYear: number, nextSeasonKey: SeasonKey) => {
    if (isSharing || (nextYear === year && nextSeasonKey === seasonKey)) {
      return;
    }
    confirmIfDirty(() => {
      setYear(nextYear);
      setSeasonKey(nextSeasonKey);
      // 手動追加はシーズン単位の編集なので、切替先へ持ち越さない。
      setManualWorks([]);
    });
  };

  // --- 保存 ---

  // 保存入力を組み立てる。ボード層の汎用 itemId を kind ごとの
  // フィールド名（annictWorkId / annictCharacterId）に写す。
  // id があれば PUT /:id、無ければ kind + スコープ値で POST。
  // listId をそのままフォールバックに使うと、シーズン切替後に
  // 前スコープの表へ PUT してしまう。season / character の既存表は
  // スコープクエリの saved だけが正しい id の出どころで、listId を
  // 使うのは POST で id が確定する custom だけに限る。
  const buildSaveInput = (cur: typeof saveSourceRef.current) => ({
    id:
      cur.saved?.id ??
      (kind === "custom" ? cur.listId : undefined) ??
      undefined,
    kind,
    season: kind === "season" ? season : undefined,
    annictWorkId: kind === "character" ? workIdParam : undefined,
    title: cur.title,
    description: cur.description,
    isPublic: cur.isPublic,
    tiers: cur.tiers,
    items: toSaveItems(cur.assignment, cur.tiers).map((i) =>
      kind === "character"
        ? { annictCharacterId: i.itemId, tierKey: i.tierKey }
        : { annictWorkId: i.itemId, tierKey: i.tierKey },
    ),
  });

  // 詳細取得の完了前に保存すると空の盤面で全置換し、既存の配置が消える。
  // custom の id 指定で保存済みが無い（削除済み等）場合も同じく弾く。
  const savedMissing =
    kind === "custom" && listId !== null && !isSavedLoading && !saved;
  const saveDisabled =
    !isDirty ||
    save.isPending ||
    isSavedLoading ||
    isSavedError ||
    savedMissing ||
    (kind === "custom" && title.trim().length === 0);

  const handleSave = () => {
    // ボタン無効化とは別に中側でも弾く（読み込み完了を待たずに
    // 空の盤面で全置換されるのを防ぐ）。
    if (saveDisabled) return;
    // 承認コールバックはダイアログを開いた時点ではなく承認時点の盤面で
    // 保存する（確認の表示中に配置を変えても古い配置で上書きされない）。
    const doSave = () => {
      const cur = saveSourceRef.current;
      save.mutate(buildSaveInput(cur), {
        onSuccess: (data) => {
          haptics.success();
          if (data.id !== listId) setListId(data.id);
          setIsDirty(false);
          // 保存対象外だった未配置の追加分は盤面からも取り除く。
          // 残しておくと「保存済み」表示と矛盾し、再表示で消える。
          setManualWorks((prev) =>
            prev.filter((w) => cur.assignment.has(w.id)),
          );
        },
      });
    };
    // ＋で追加したがどの tier にも配置していない作品は保存対象にならず、
    // 画面を離れると消える。「保存したのに消えた」を防ぐため一度だけ確認する。
    const hasUnassignedAdded = [...manualWorks, ...lookupWorks].some(
      (w) => !assignment.has(w.id),
    );
    if (hasUnassignedAdded) {
      confirm(
        t("未配置の追加作品があります"),
        t("未分類に残っている追加分は保存されず、このままだと消えます。"),
        doSave,
        { confirmLabel: t("このまま保存"), cancelLabel: t("編集を続ける") },
      );
      return;
    }
    doSave();
  };

  // 共有は「見えている盤面そのもの」を渡したいので、未保存変更があっても
  // 確認ダイアログではなく先に保存してから共有フローへ進む。
  const saveTierListData = async () => {
    // 共有フローは isSharing で編集を止めるが、開始直前までの編集も
    // 反映できるよう実行時点の最新値から組み立てる。
    const cur = saveSourceRef.current;
    const savedData = await save.mutateAsync(buildSaveInput(cur));
    if (savedData.id !== listId) setListId(savedData.id);
    setIsDirty(false);
    // 保存ボタンと同じく、保存に載らなかった未配置の追加分は盤面から外す。
    setManualWorks((prev) => prev.filter((w) => cur.assignment.has(w.id)));
    return savedData;
  };

  // web では共有モーダル（コピー / X 共有 / 画像）、native では
  // OS 共有シート。generateImageFile は web のモーダルでのみ使われる。
  // generateImageFile は宣言より後でしか呼ばれないため、ここで参照してよい。
  const {
    beginShare,
    cancelShare,
    shareUrl: presentShareUrl,
    urlShareElement,
  } = useTierUrlShare({
    tweetText: title,
    generateImageFile: () => generateImageFile(),
  });

  const handleShareUrl = () =>
    shareTierListViaUrl({
      beginShare,
      cancelShare,
      setIsSharing,
      createShareUrl: async () => {
        const savedData = await saveTierListData();
        const { shareToken } = await share.mutateAsync(savedData.id);
        return buildTierListShareUrl(shareToken, webUrl);
      },
      presentShareUrl,
      onFailure: () =>
        alert(t("共有に失敗しました"), t("時間をおいて再度お試しください。"), {
          okLabel: "OK",
        }),
    });

  // 盤面を保存し、保存結果をスナップショットに描画させてから run を実行する。
  // try/finally は React Compiler が最適化できないため lib/tierList/share/flow.ts に置く。
  const withRenderedSnapshot = <T,>(run: () => Promise<T>): Promise<T> =>
    withRenderedTierSnapshot({
      saveBoard: saveTierListData,
      mapItem: (i) =>
        i.kind === "work"
          ? {
              id: i.annictWorkId,
              tierKey: i.tierKey,
              title: i.title,
              imageUrl: i.hostedImageUrl,
            }
          : {
              id: i.annictCharacterId,
              tierKey: i.tierKey,
              title: i.name,
              imageUrl: i.imageUrl,
            },
      snapshotReadyRef,
      snapshotRef,
      setSnapshotItems,
      setIsSharing,
      renderFailedMessage: t("スナップショットの描画に失敗しました"),
      run,
    });

  const handleShareImage = async () => {
    try {
      // 共有画像は撮影時点のスキームに合わせる（盤面と同じ見た目の画像にする）
      await withRenderedSnapshot(() =>
        shareTierListImage(snapshotRef, {
          dialogTitle: title,
          backgroundColor: colors.background,
        }),
      );
    } catch {
      alert(
        t("画像の共有に失敗しました"),
        t("時間をおいて再度お試しください。"),
        {
          okLabel: "OK",
        },
      );
    }
  };

  // web 共有モーダル用: PNG 化した画像 File を生成して返す。
  // 共有・ダウンロードへの受け渡しはモーダル側の別ボタンが行う
  // （生成待ちの後に navigator.share を呼ぶとユーザー操作期限で失敗するため）。
  const generateImageFile = () => {
    // web 共有モーダルの「画像を生成する」押下を計測する（issue #214）。
    trackEvent("tier_image_generate");
    return withRenderedSnapshot(() =>
      captureTierListImageFile(snapshotRef, {
        title,
        backgroundColor: colors.background,
      }),
    );
  };

  // --- 候補の読み込み状態を kind ごとに畳み込む ---
  const isCandidatesLoading =
    kind === "season"
      ? seasonWorks.isLoading
      : kind === "character"
        ? workCharacters.isLoading
        : lookup.isLoading;
  const isCandidatesError =
    kind === "season"
      ? seasonWorks.isError
      : kind === "character"
        ? workCharacters.isError
        : lookup.isError && boardItems.length === 0;

  // 共有は「盤面を保存 → トークン発行」を行う。保存済みデータ・候補一覧の
  // 読み込み中（or 取得失敗）に実行すると、初期状態や別スコープの盤面を
  // 上書き保存してしまうため、データが確定するまで共有を開始させない。
  const shareDisabled =
    isSharing ||
    save.isPending ||
    isSavedLoading ||
    isSavedError ||
    isCandidatesLoading ||
    savedMissing ||
    (kind === "custom" && title.trim().length === 0);

  const handleShare = () => {
    if (shareDisabled) return;
    if (isCandidatesError) {
      alert(
        t("共有できません"),
        t(
          "Tier 表のデータを取得できませんでした。時間をおいて再度お試しください。",
        ),
        {
          okLabel: "OK",
        },
      );
      return;
    }
    // 共有ボタンの押下と、続く選択肢の方式（issue #214）を計測する。
    trackEvent("tier_share_open");
    presentTierShareOptions({
      dialogTitle: t("Tier 表を共有"),
      urlLabel: t("URL を共有"),
      imageLabel: t("画像で共有"),
      cancelLabel: t("キャンセル"),
      // 方式の計測は選択肢を実際に提示する側（options.native.ts / Web は
      // モーダル内の各ボタン）で行う。ここで送ると Web でモーダルを
      // 開いただけなのに method:url が記録されてしまう。
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
      onShareUrl: () => void handleShareUrl(),
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
      onShareImage: () => void handleShareImage(),
    });
  };

  // 戻る導線は盤面・ローディング・ソフトゲートの全分岐に必要なので切り出す
  // （どの状態でも画面に閉じ込められないようにするため）。
  const backBar = (
    <View style={styles.headerTop}>
      <BackButton
        onPress={handleBack}
        style={styles.backButton}
        accessibilityLabel={t("戻る")}
        testID={`${idPrefix}-back`}
      />
    </View>
  );

  if (kind === "character" && !validWorkId) {
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>{backBar}</View>
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            {t("対象の作品を特定できませんでした")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isAccessLoading) {
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>{backBar}</View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      </SafeAreaView>
    );
  }

  if (!canBrowseWorks) {
    // 候補の取得は本人の Annict トークンか共用トークンが要る（issue #561）。
    // どちらも無いと盤面自体が空になるため、連携誘導を最優先で出す。
    const gateDescription =
      kind === "character"
        ? "キャラクター Tier 表の作成には Annict との連携が必要です。連携すると作品のキャラクターを並べ替えられます。"
        : kind === "custom"
          ? "自由作成の Tier 表には Annict との連携が必要です。連携すると作品を検索して追加できます。"
          : "Tier 表の作成には Annict との連携が必要です。連携するとシーズンの全作品を並べ替えられます。";
    const gateSurface =
      kind === "character"
        ? "character_tier_list"
        : kind === "custom"
          ? "custom_tier_list"
          : "tier_list";
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>{backBar}</View>
        <AnnictSoftGate
          description={gateDescription}
          surface={gateSurface}
          testID={`${idPrefix}-soft-gate`}
        />
      </SafeAreaView>
    );
  }

  const boardReady =
    !isCandidatesError &&
    !isSavedError &&
    !isSavedLoading &&
    !isCandidatesLoading &&
    (kind !== "character" || workCharacters.characters.length > 0);
  const boardHeader = (
    <>
      <View style={styles.header}>
        {backBar}
        {kind === "custom" ? (
          // タイトルはテーマ名そのもの。シーズン版の固定タイトルと違い
          // ユーザーが付けるため、保存の前提（空不可・50 文字）を
          // 入力側に置く。
          <Input
            value={title}
            onChangeText={handleChangeTitle}
            placeholder={t("テーマ名（例: 歴代で好きなアニメ）")}
            maxLength={TITLE_MAX_LENGTH}
            testID={`${idPrefix}-title`}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              padding: 12,
              fontSize: 16,
              color: colors.text,
            }}
          />
        ) : (
          <Text style={styles.headerTitle}>{title}</Text>
        )}
        <TierListMetaFields
          description={description}
          onChangeDescription={handleChangeDescription}
          isPublic={isPublic}
          shareToken={saved?.shareToken ?? null}
          onChangeIsPublic={handleChangeIsPublic}
          disabled={
            isSharing || save.isPending || isSavedLoading || isSavedError
          }
          testIDPrefix={idPrefix}
        />
        <Text style={styles.headerHint}>
          {kind === "character"
            ? t(
                "キャラクターは作品のキャストから読み込まれます。長押しドラッグで tier を移動でき、tier 名はタップで変更できます",
              )
            : kind === "custom"
              ? t(
                  "作品を検索して追加し、長押しドラッグで tier を移動できます。tier 名はタップで変更できます",
                )
              : t(
                  "作品を長押ししてドラッグすると tier を移動できます。tier 名はタップで変更できます",
                )}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[
              styles.shareButton,
              shareDisabled && styles.saveButtonDisabled,
            ]}
            onPress={handleShare}
            disabled={shareDisabled}
            accessibilityRole="button"
            accessibilityLabel={t("tier 表を共有")}
            accessibilityState={{ disabled: shareDisabled }}
            testID={`${idPrefix}-share`}
          >
            {isSharing ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>{t("共有")}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.saveButton,
              saveDisabled && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={saveDisabled}
            accessibilityRole="button"
            accessibilityLabel={t("tier 表を保存")}
            accessibilityState={{ disabled: saveDisabled }}
            testID={`${idPrefix}-save`}
          >
            {save.isPending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>
                {isDirty ? t("保存") : t("保存済み")}
              </Text>
            )}
          </TouchableOpacity>
          {save.isError && (
            <Text style={styles.centeredText}>{t("保存に失敗しました")}</Text>
          )}
        </View>
        {kind === "character" ? (
          // 旧キャラ画面が持っていた共有/保存の役割説明（issue #606）。
          <Text style={styles.headerHint}>
            {t(
              "「共有」は閲覧用リンクや画像の発行、「保存」は編集内容の保存です",
            )}
          </Text>
        ) : null}
      </View>

      {kind === "season" ? (
        <SeasonFilter
          year={year}
          season={seasonKey}
          onChange={handleChangeSeason}
        />
      ) : null}
    </>
  );

  const candidatesEmpty =
    kind === "character" && workCharacters.characters.length === 0;

  return (
    <SafeAreaView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {!boardReady ? boardHeader : null}

      {isCandidatesError ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            {kind === "character"
              ? t("キャラクターを取得できませんでした")
              : t("シーズンの作品を取得できませんでした")}
          </Text>
        </View>
      ) : isSavedError ? (
        // 保存済み表の取得失敗。空の盤面を出すと続く保存で既存配置を
        // 消してしまうため、ボードは描画しない
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            {t("保存済みの tier 表を取得できませんでした")}
          </Text>
        </View>
      ) : isCandidatesLoading || isSavedLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textMuted} />
          <Text style={styles.centeredText}>
            {kind === "character"
              ? t("キャラクターを集めています")
              : kind === "custom"
                ? t("Tier 表を読み込んでいます")
                : t("シーズンの作品を集めています")}
          </Text>
        </View>
      ) : candidatesEmpty ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            {t("この作品のキャラクターが見つかりませんでした")}
          </Text>
        </View>
      ) : (
        // シーズン候補が 0 件でも盤面を出す。＋ボタンから手動追加できる
        // 道を残すため（issue #168）、空のときだけ別画面にはしない。
        <TierBoard
          header={boardHeader}
          // キャラ版は項目タップ・＋追加を持たない。exactOptionalPropertyTypes
          // のため undefined を渡すのではなく props 自体を省略する。
          {...(kind === "character"
            ? {}
            : {
                onItemPress: (item: TierItem) =>
                  openWork({
                    annictWorkId: item.id,
                    title: item.title,
                    hostedImageUrl: item.imageUrl,
                  }),
                onAddItem: handleAddWork,
              })}
          tiers={tiers}
          items={boardItems}
          assignment={assignment}
          onAssign={handleAssign}
          onRenameTier={handleRenameTier}
          labelsEditable={!isSharing && !save.isPending}
          trayEmptyLabel={
            kind === "character"
              ? t("すべてのキャラクターを配置しました")
              : kind === "custom"
                ? t("作品を検索して追加できます")
                : t("すべての作品を配置しました")
          }
        />
      )}

      {/*
        画像共有用のスナップショット。画面外に置いて常時非表示にし、
        共有実行の瞬間だけ描画 → キャプチャ → 破棄する。
        中身は保存済みデータ（savedData.items）なので、共有リンク先と
        同じ内容が画像になる。
      */}
      {snapshotItems && (
        <View style={styles.snapshotOffscreen}>
          <TierBoardSnapshot
            ref={snapshotRef}
            title={title}
            tiers={tiers}
            items={snapshotItems}
            onReady={() => snapshotReadyRef.current?.()}
          />
        </View>
      )}

      {/* web のみ共有モーダル（native は null が返る） */}
      {urlShareElement}
    </SafeAreaView>
  );
}
