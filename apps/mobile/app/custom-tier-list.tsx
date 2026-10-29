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
import { apiUrl } from "@/lib/apiUrl";
import { alert, confirm } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { useAnnictConnection } from "@/lib/annict";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { BackButton, Input } from "@/components/ui";
import { TierBoard } from "@/components/tier-list/TierBoard";
import {
  TierBoardSnapshot,
  type SnapshotItem,
} from "@/components/tier-list/TierBoardSnapshot";
import { useTierListStyles } from "@/components/tier-list/tierListStyles";
import { useThemeColors } from "@/lib/theme";
import {
  assignItem,
  mergeBoardItems,
  parseTiersJson,
  toAssignment,
  toSaveItems,
} from "@/lib/tierList/board";
import { DEFAULT_TIERS } from "@/lib/tierList/defaults";
import { renameTier } from "@/lib/tierList/label";
import {
  buildCustomTierListShareUrl,
  captureTierListImageFile,
  presentTierShareOptions,
  shareTierListImage,
  useTierUrlShare,
} from "@/lib/tierList/share";
import type { TierAssignment, TierItem, TierRow } from "@/lib/tierList/types";
import {
  useSavedCustomTierList,
  useSaveCustomTierList,
  useShareCustomTierList,
} from "@/lib/tierList/useCustomTierList";
import { useWorksLookup } from "@/lib/tierList/useWorksLookup";

/**
 * テーマを決めて自由に作る tier 表の編集画面（issue #348）。
 *
 * シーズン版（tier-list.tsx）と違い候補がシーズンに縛られないため、
 * 盤面に並ぶ作品は「保存済み items + workIds パラメータで引き継いだ初期
 * 作品 + 検索シートからの手動追加」の合成になる。
 *
 * ルートパラメータ:
 * - `id`      : 既存の表を開く（tier-lists 一覧からの遷移）。無ければ新規作成。
 * - `workIds` : 初期作品の annictWorkId（カンマ区切り）。issue #349 の
 *               作品リストからの引き継ぎ入口。新規作成時の初期トレイに使う。
 */

/** 画像キャプチャ前にスナップショットの画像読み込みを待つ上限。 */
const SNAPSHOT_WAIT_MAX_MS = 5000;
/** API のタイトル上限（customTierListSaveSchema.max(50)）と揃える。 */
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

export default function CustomTierListScreen() {
  const router = useRouter();
  const styles = useTierListStyles();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ id?: string; workIds?: string }>();

  // 新規作成の最初の保存（POST）で id が確定する。以降の保存は PUT に
  // 切り替わるよう、確定した id を画面状態として持つ（URL は書き換えない。
  // パラメータを書き換えるとナビゲーションが余計に走るため）。
  const idParam = params.id ? Number(params.id) : null;
  const [listId, setListId] = useState<number | null>(
    idParam !== null && Number.isFinite(idParam) && idParam > 0
      ? idParam
      : null,
  );

  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  const { data: saved, isLoading: isSavedLoading } =
    useSavedCustomTierList(listId);

  // #349 からの引き継ぎ作品。編集（id 指定）では既に保存 items に入って
  // いるので、新規作成時だけ初期トレイに並べる。
  const initialWorkIds = useMemo(
    () => (listId === null ? parseWorkIdsParam(params.workIds) : []),
    [listId, params.workIds],
  );
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

  const save = useSaveCustomTierList();
  const share = useShareCustomTierList();

  const [tiers, setTiers] = useState<TierRow[]>(DEFAULT_TIERS);
  const [assignment, setAssignment] = useState<TierAssignment>(new Map());
  // ＋ボタンの検索シートから手動追加した作品（issue #168 と同じ仕組み）。
  const [manualWorks, setManualWorks] = useState<TierItem[]>([]);
  const [title, setTitle] = useState("");
  // 未保存の変更があるか。保存ボタンの活性と「保存済み」表示の出し分けに使う。
  const [isDirty, setIsDirty] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [snapshotItems, setSnapshotItems] = useState<SnapshotItem[] | null>(
    null,
  );
  const snapshotRef = useRef<ViewInstance>(null);
  const snapshotReadyRef = useRef<(() => void) | null>(null);
  const saveSourceRef = useRef({ listId, title, tiers, assignment });
  useEffect(() => {
    saveSourceRef.current = { listId, title, tiers, assignment };
  });

  // 保存済みデータで状態を差し替える。編集中（isDirty）は上書きしない
  // （シーズン版と同じく、effect での同期 setState を避けるため
  // レンダー中に調整する）。新規（id 無し）は初期値のまま。
  const [hydrated, setHydrated] = useState<{
    id: number | null;
    saved: typeof saved;
  } | null>(null);
  if (
    !isSavedLoading &&
    (hydrated?.id !== listId || (!isDirty && hydrated.saved !== saved))
  ) {
    setHydrated({ id: listId, saved });
    if (saved) {
      setTiers(parseTiersJson(saved.tiersJson) ?? DEFAULT_TIERS);
      setAssignment(
        toAssignment(
          saved.items.map((i) => ({
            itemId: i.annictWorkId,
            tierKey: i.tierKey,
          })),
        ),
      );
      setTitle(saved.title);
    } else {
      setTiers(DEFAULT_TIERS);
      setAssignment(new Map());
    }
    setIsDirty(false);
  }

  // 盤面に並べる作品集合。保存済み items を本体に、初期引き継ぎ作品
  // （lookupWorks）と手動追加分（manualWorks）を補完する。
  const boardWorks = useMemo<TierItem[]>(
    () =>
      mergeBoardItems(
        (saved?.items ?? []).map((item) => ({
          id: item.annictWorkId,
          title: item.title,
          imageUrl: item.hostedImageUrl,
        })),
        lookupWorks,
        manualWorks,
      ),
    [saved, lookupWorks, manualWorks],
  );

  const handleAssign = useCallback(
    (itemId: number, tierKey: string | null, beforeItemId?: number) => {
      // 共有・保存中の編集は受け付けない（シーズン版と同じ理由）。
      if (isSharing || save.isPending) return;
      setAssignment((prev) => assignItem(prev, itemId, tierKey, beforeItemId));
      setIsDirty(true);
    },
    [isSharing, save.isPending],
  );

  // 検索シートから選ばれた作品を未分類トレイへ追加する。
  const handleAddWork = useCallback(
    (work: TierItem) => {
      if (isSharing || save.isPending) return;
      if (boardWorks.some((w) => w.id === work.id)) return;
      trackEvent("tier_work_add");
      setManualWorks((prev) => [...prev, work]);
      setIsDirty(true);
    },
    [isSharing, save.isPending, boardWorks],
  );

  const handleRenameTier = useCallback(
    (tierKey: string, label: string) => {
      if (isSharing || save.isPending) return;
      const next = renameTier(tiers, tierKey, label);
      if (next === tiers) return;
      setTiers(next);
      setIsDirty(true);
    },
    [isSharing, save.isPending, tiers],
  );

  const handleChangeTitle = useCallback(
    (next: string) => {
      if (isSharing || save.isPending) return;
      setTitle(next);
      setIsDirty(true);
    },
    [isSharing, save.isPending],
  );

  const handleBack = useCallback(() => {
    const goBack = () => {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace("/tier-lists");
    };

    if (isDirty) {
      confirm(
        "保存していない変更があります",
        "このまま戻ると編集した内容は失われます。",
        goBack,
        {
          confirmLabel: "破棄して戻る",
          cancelLabel: "編集を続ける",
          destructive: true,
        },
      );
      return;
    }
    goBack();
  }, [isDirty, router]);

  const handleSave = useCallback(() => {
    const doSave = () => {
      const cur = saveSourceRef.current;
      save.mutate(
        {
          id: cur.listId ?? undefined,
          title: cur.title,
          tiers: cur.tiers,
          items: toSaveItems(cur.assignment, cur.tiers).map((i) => ({
            annictWorkId: i.itemId,
            tierKey: i.tierKey,
          })),
        },
        {
          onSuccess: (data) => {
            setListId(data.id);
            setIsDirty(false);
            // 保存対象外だった未配置の追加分は盤面からも取り除く。
            setManualWorks((prev) =>
              prev.filter((w) => cur.assignment.has(w.id)),
            );
          },
        },
      );
    };
    // 未配置の追加分は保存されない。「保存したのに消えた」を防ぐため
    // 一度だけ確認する（シーズン版と同じ）。
    const hasUnassignedManual = manualWorks.some((w) => !assignment.has(w.id));
    if (hasUnassignedManual) {
      confirm(
        "未配置の追加作品があります",
        "未分類に残っている追加分は保存されず、このままだと消えます。",
        doSave,
        { confirmLabel: "このまま保存", cancelLabel: "編集を続ける" },
      );
      return;
    }
    doSave();
  }, [assignment, manualWorks, save]);

  // 共有は「見えている盤面そのもの」を渡したいので、未保存変更があっても
  // 確認ダイアログではなく先に保存してから共有フローへ進む。
  const saveTierListData = useCallback(async () => {
    const cur = saveSourceRef.current;
    const savedData = await save.mutateAsync({
      id: cur.listId ?? undefined,
      title: cur.title,
      tiers: cur.tiers,
      items: toSaveItems(cur.assignment, cur.tiers).map((i) => ({
        annictWorkId: i.itemId,
        tierKey: i.tierKey,
      })),
    });
    setListId(savedData.id);
    setIsDirty(false);
    setManualWorks((prev) => prev.filter((w) => cur.assignment.has(w.id)));
    return savedData;
  }, [save]);

  const saveTierListDataRef = useRef(saveTierListData);
  useEffect(() => {
    saveTierListDataRef.current = saveTierListData;
  });

  const { shareUrl: presentShareUrl, urlShareElement } = useTierUrlShare({
    tweetText: title,
    generateImageFile: () => generateImageFile(),
  });

  const handleShareUrl = useCallback(async () => {
    setIsSharing(true);
    try {
      const savedData = await saveTierListData();
      const { shareToken } = await share.mutateAsync(savedData.id);
      const url = buildCustomTierListShareUrl(shareToken, apiUrl);
      await presentShareUrl(url);
    } catch {
      alert("共有に失敗しました", "時間をおいて再度お試しください。", {
        okLabel: "OK",
      });
    } finally {
      setIsSharing(false);
    }
  }, [presentShareUrl, saveTierListData, share]);

  // 盤面を保存し、保存結果をスナップショットに描画させてから run を実行する
  // 共通処理（シーズン版と同じ流れ）。
  const withRenderedSnapshot = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      setIsSharing(true);
      try {
        const savedData = await saveTierListDataRef.current();
        const snapshotReady = new Promise<void>((resolve) => {
          snapshotReadyRef.current = resolve;
        });
        setSnapshotItems(
          savedData.items.map((i) => ({
            id: i.annictWorkId,
            tierKey: i.tierKey,
            title: i.title,
            imageUrl: i.hostedImageUrl,
          })),
        );
        await Promise.race([
          snapshotReady,
          new Promise((resolve) => setTimeout(resolve, SNAPSHOT_WAIT_MAX_MS)),
        ]);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!snapshotRef.current) {
          throw new Error("スナップショットの描画に失敗しました");
        }
        return await run();
      } finally {
        setSnapshotItems(null);
        setIsSharing(false);
      }
    },
    [],
  );

  const handleShareImage = useCallback(async () => {
    try {
      await withRenderedSnapshot(() =>
        shareTierListImage(snapshotRef, {
          dialogTitle: title,
          backgroundColor: colors.background,
        }),
      );
    } catch {
      alert("画像の共有に失敗しました", "時間をおいて再度お試しください。", {
        okLabel: "OK",
      });
    }
  }, [withRenderedSnapshot, title, colors]);

  const generateImageFile = useCallback(() => {
    trackEvent("tier_image_generate");
    return withRenderedSnapshot(() =>
      captureTierListImageFile(snapshotRef, {
        title,
        backgroundColor: colors.background,
      }),
    );
  }, [withRenderedSnapshot, title, colors]);

  // 共有は「盤面を保存 → トークン発行」を行う。保存データの読み込み中や
  // タイトル未入力のまま実行すると不完全な内容を保存・共有してしまうため、
  // データが確定するまで共有を開始させない。
  const shareDisabled =
    isSharing || save.isPending || isSavedLoading || title.trim().length === 0;

  const handleShare = useCallback(() => {
    if (shareDisabled) return;
    trackEvent("tier_share_open");
    presentTierShareOptions({
      dialogTitle: "Tier 表を共有",
      urlLabel: "URL を共有",
      imageLabel: "画像で共有",
      cancelLabel: "キャンセル",
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
      onShareUrl: () => void handleShareUrl(),
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
      onShareImage: () => void handleShareImage(),
    });
  }, [handleShareUrl, handleShareImage, shareDisabled]);

  const backBar = (
    <View style={styles.headerTop}>
      <BackButton
        onPress={handleBack}
        style={styles.backButton}
        accessibilityLabel="戻る"
        testID="custom-tier-list-back"
      />
    </View>
  );

  if (isConnectionLoading) {
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

  if (!isConnected) {
    // 作品の検索・追加は Annict トークン必須。未連携では作品を集められない
    // ため、連携誘導を最優先で出す（シーズン版と同じ）。
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>{backBar}</View>
        <AnnictSoftGate
          description="自由作成の Tier 表には Annict との連携が必要です。連携すると作品を検索して追加できます。"
          surface="custom_tier_list"
          testID="custom-tier-list-soft-gate"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        {backBar}
        {/* タイトルはテーマ名そのもの。シーズン版の固定タイトルと違い
            ユーザーが付けるため、保存の前提（空不可・50 文字）を
            入力側に置く。 */}
        <Input
          value={title}
          onChangeText={handleChangeTitle}
          placeholder="テーマ名（例: 歴代で好きなアニメ）"
          maxLength={TITLE_MAX_LENGTH}
          testID="custom-tier-list-title"
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            padding: 12,
            fontSize: 16,
            color: colors.text,
          }}
        />
        <Text style={styles.headerHint}>
          作品を検索して追加し、長押しドラッグで tier を移動できます。tier
          名はタップで変更できます
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
            accessibilityLabel="tier 表を共有"
            accessibilityState={{ disabled: shareDisabled }}
            testID="custom-tier-list-share"
          >
            {isSharing ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>共有</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.saveButton,
              (!isDirty || save.isPending || title.trim().length === 0) &&
                styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!isDirty || save.isPending || title.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="tier 表を保存"
            accessibilityState={{
              disabled: !isDirty || save.isPending || title.trim().length === 0,
            }}
            testID="custom-tier-list-save"
          >
            {save.isPending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>
                {isDirty ? "保存" : "保存済み"}
              </Text>
            )}
          </TouchableOpacity>
          {save.isError && (
            <Text style={styles.centeredText}>保存に失敗しました</Text>
          )}
        </View>
      </View>

      {isSavedLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textMuted} />
          <Text style={styles.centeredText}>Tier 表を読み込んでいます</Text>
        </View>
      ) : (
        <TierBoard
          tiers={tiers}
          items={boardWorks}
          assignment={assignment}
          onAssign={handleAssign}
          onRenameTier={handleRenameTier}
          onAddItem={handleAddWork}
          labelsEditable={!isSharing && !save.isPending}
          trayEmptyLabel="作品を検索して追加できます"
        />
      )}

      {/* 画像共有用のスナップショット（シーズン版と同じ仕組み） */}
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
