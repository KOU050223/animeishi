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
import { DEFAULT_TIERS } from "@/lib/tierList/defaults";
import { renameTier } from "@/lib/tierList/label";
import {
  buildCustomTierListShareUrl,
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
  const { t } = useTranslation();
  const openWork = useOpenWorkDetail();
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

  const { canBrowseWorks, isLoading: isAccessLoading } = useWorkCatalogAccess();
  const { data: saved, isLoading: isSavedLoading } =
    useSavedCustomTierList(listId);

  // #349 からの引き継ぎ作品。編集（id 指定）では既に保存 items に入って
  // いるので、新規作成時だけ初期トレイに並べる。
  const initialWorkIds =
    listId === null ? parseWorkIdsParam(params.workIds) : [];
  const lookup = useWorksLookup(initialWorkIds);
  // kept boardWorks の依存なので参照を固定する。
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
  // 表の説明文と、ひろばの公開一覧に載せるか（issue #476）。
  // 共有 URL（share_token）とは独立した設定。
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  // 未保存の変更があるか。保存ボタンの活性と「保存済み」表示の出し分けに使う。
  const [isDirty, setIsDirty] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [snapshotItems, setSnapshotItems] = useState<SnapshotItem[] | null>(
    null,
  );
  const snapshotRef = useRef<ViewInstance>(null);
  const snapshotReadyRef = useRef<(() => void) | null>(null);
  const saveSourceRef = useRef({
    listId,
    title,
    description,
    isPublic,
    tiers,
    assignment,
  });
  useEffect(() => {
    saveSourceRef.current = {
      listId,
      title,
      description,
      isPublic,
      tiers,
      assignment,
    };
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
      setDescription(saved.description ?? "");
      setIsPublic(saved.isPublic);
    } else {
      setTiers(DEFAULT_TIERS);
      setAssignment(new Map());
      setDescription("");
      setIsPublic(false);
    }
    setIsDirty(false);
  }

  // 盤面に並べる作品集合。保存済み items を本体に、初期引き継ぎ作品
  // （lookupWorks）と手動追加分（manualWorks）を補完する。
  // TierBoard の items prop（内部のジェスチャ依存チェーン）に渡すため参照を固定する。
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

  // TierBoard 内のドラッグ系コールバックの依存に入るため参照を固定する。
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
  const handleAddWork = (work: TierItem) => {
    if (isSharing || save.isPending) return;
    // 既に盤面にある作品は無視する。
    if (boardWorks.some((w) => w.id === work.id)) return;
    trackEvent("tier_work_add");
    setManualWorks((prev) => [...prev, work]);
    setIsDirty(true);
  };

  const handleRenameTier = (tierKey: string, label: string) => {
    if (isSharing || save.isPending) return;
    const next = renameTier(tiers, tierKey, label);
    if (next === tiers) return;
    setTiers(next);
    setIsDirty(true);
  };

  const handleChangeTitle = (next: string) => {
    if (isSharing || save.isPending) return;
    setTitle(next);
    setIsDirty(true);
  };

  const handleChangeDescription = (next: string) => {
    // 読み込み中は hydrate が入力を上書きするため受け付けない
    // （保存ボタンと同じく詳細取得の完了を待つ）。
    if (isSharing || save.isPending || isSavedLoading) return;
    setDescription(next);
    setIsDirty(true);
  };

  const handleChangeIsPublic = (next: boolean) => {
    if (isSharing || save.isPending || isSavedLoading) return;
    setIsPublic(next);
    setIsDirty(true);
  };

  const handleBack = () => {
    const goBack = () => {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace("/tier-lists");
    };

    if (isDirty) {
      confirm(
        t("保存していない変更があります"),
        t("このまま戻ると編集した内容は失われます。"),
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

  // 詳細取得の完了前に保存すると空の盤面で全置換し、既存の配置が消える。
  // 404（削除済み）の表も PUT が失敗するだけなので、id 指定では saved が
  // 確定するまで保存・共有を開始させない。
  const savedMissing = listId !== null && !isSavedLoading && !saved;
  const saveDisabled =
    !isDirty ||
    save.isPending ||
    isSavedLoading ||
    savedMissing ||
    title.trim().length === 0;

  const handleSave = () => {
    // ボタン無効化とは別に中側でも弾く（読み込み完了を待たずに
    // 空の盤面で全置換されるのを防ぐ）。
    if (saveDisabled) return;
    const doSave = () => {
      const cur = saveSourceRef.current;
      save.mutate(
        {
          id: cur.listId ?? undefined,
          title: cur.title,
          description: cur.description,
          isPublic: cur.isPublic,
          tiers: cur.tiers,
          items: toSaveItems(cur.assignment, cur.tiers).map((i) => ({
            annictWorkId: i.itemId,
            tierKey: i.tierKey,
          })),
        },
        {
          onSuccess: (data) => {
            haptics.success();
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
    // 未配置の追加・引き継ぎ作品は保存されない。「保存したのに消えた」を
    // 防ぐため一度だけ確認する（シーズン版と同じ）。
    const hasUnassigned = [...manualWorks, ...lookupWorks].some(
      (w) => !assignment.has(w.id),
    );
    if (hasUnassigned) {
      confirm(
        t("未配置の作品があります"),
        t("未分類に残っている作品は保存されず、このままだと消えます。"),
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
    const cur = saveSourceRef.current;
    const savedData = await save.mutateAsync({
      id: cur.listId ?? undefined,
      title: cur.title,
      description: cur.description,
      isPublic: cur.isPublic,
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
  };

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
        return buildCustomTierListShareUrl(shareToken, webUrl);
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
      mapItem: (i) => ({
        id: i.annictWorkId,
        tierKey: i.tierKey,
        title: i.title,
        imageUrl: i.hostedImageUrl,
      }),
      snapshotReadyRef,
      snapshotRef,
      setSnapshotItems,
      setIsSharing,
      renderFailedMessage: t("スナップショットの描画に失敗しました"),
      run,
    });

  const handleShareImage = async () => {
    try {
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

  const generateImageFile = () => {
    trackEvent("tier_image_generate");
    return withRenderedSnapshot(() =>
      captureTierListImageFile(snapshotRef, {
        title,
        backgroundColor: colors.background,
      }),
    );
  };

  // 共有は「盤面を保存 → トークン発行」を行う。保存データの読み込み中や
  // タイトル未入力のまま実行すると不完全な内容を保存・共有してしまうため、
  // データが確定するまで共有を開始させない。
  const shareDisabled =
    isSharing ||
    save.isPending ||
    isSavedLoading ||
    (title.trim().length === 0 && !savedMissing);

  const handleShare = () => {
    if (shareDisabled) return;
    if (savedMissing) {
      alert(
        t("共有できません"),
        t("Tier 表を取得できませんでした。時間をおいて再度お試しください。"),
        {
          okLabel: "OK",
        },
      );
      return;
    }
    trackEvent("tier_share_open");
    presentTierShareOptions({
      dialogTitle: t("Tier 表を共有"),
      urlLabel: t("URL を共有"),
      imageLabel: t("画像で共有"),
      cancelLabel: t("キャンセル"),
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
      onShareUrl: () => void handleShareUrl(),
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
      onShareImage: () => void handleShareImage(),
    });
  };

  const backBar = (
    <View style={styles.headerTop}>
      <BackButton
        onPress={handleBack}
        style={styles.backButton}
        accessibilityLabel={t("戻る")}
        testID="custom-tier-list-back"
      />
    </View>
  );

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
    // 作品の検索・追加は本人の Annict トークンか共用トークンが要る（issue #561）。
    // どちらも無いと作品を集められないため、連携誘導を最優先で出す（シーズン版と同じ）。
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

  const boardReady = !isSavedLoading;
  const boardHeader = (
    <>
      <View style={styles.header}>
        {backBar}
        {/* タイトルはテーマ名そのもの。シーズン版の固定タイトルと違い
            ユーザーが付けるため、保存の前提（空不可・50 文字）を
            入力側に置く。 */}
        <Input
          value={title}
          onChangeText={handleChangeTitle}
          placeholder={t("テーマ名（例: 歴代で好きなアニメ）")}
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
        <TierListMetaFields
          description={description}
          onChangeDescription={handleChangeDescription}
          isPublic={isPublic}
          shareToken={saved?.shareToken ?? null}
          onChangeIsPublic={handleChangeIsPublic}
          disabled={isSharing || save.isPending || isSavedLoading}
          testIDPrefix="custom-tier-list"
        />
        <Text style={styles.headerHint}>
          {t(
            "作品を検索して追加し、長押しドラッグで tier を移動できます。tier 名はタップで変更できます",
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
            testID="custom-tier-list-share"
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
            testID="custom-tier-list-save"
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
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {!boardReady ? boardHeader : null}

      {isSavedLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textMuted} />
          <Text style={styles.centeredText}>
            {t("Tier 表を読み込んでいます")}
          </Text>
        </View>
      ) : (
        <TierBoard
          header={boardHeader}
          onItemPress={(item) =>
            openWork({
              annictWorkId: item.id,
              title: item.title,
              hostedImageUrl: item.imageUrl,
            })
          }
          tiers={tiers}
          items={boardWorks}
          assignment={assignment}
          onAssign={handleAssign}
          onRenameTier={handleRenameTier}
          onAddItem={handleAddWork}
          labelsEditable={!isSharing && !save.isPending}
          trayEmptyLabel={t("作品を検索して追加できます")}
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
