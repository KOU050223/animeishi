import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { apiUrl } from "@/lib/apiUrl";
import { alert, confirm } from "@/lib/dialog";
import { useAnnictConnection } from "@/lib/annict";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { BackButton, Input } from "@/components/ui";
import { WorkAddSheet } from "@/components/tier-list/WorkAddSheet";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { useThemeColors } from "@/lib/theme";
import { buildWorkListShareUrl } from "@/lib/workList/shareUrl";
import type { TierItem } from "@/lib/tierList/types";
import type { WorkListEntry } from "@/lib/workList/types";
import {
  useSavedWorkList,
  useSaveWorkList,
  useShareWorkList,
  useUnshareWorkList,
} from "@/lib/workList/useWorkLists";

/**
 * オリジナル作品リストの編集画面（issue #349）。
 *
 * タイトル・説明を付けて、検索した作品を順位付きで並べる。
 * 「このリストで Tier 表を作る」は #348 の作成画面へ workIds で作品を
 * 引き継ぐ。共有は視聴履歴と同じくトークン URL の発行・コピー・解除。
 *
 * ルートパラメータ:
 * - `id` : 既存のリストを開く（work-lists 一覧からの遷移）。無ければ新規作成。
 */

/** API のタイトル上限（workListSaveSchema.max(50)）と揃える。 */
const TITLE_MAX_LENGTH = 50;
/** API の説明上限（workListSaveSchema.max(500)）と揃える。 */
const DESCRIPTION_MAX_LENGTH = 500;
/** 「コピーしました」表示の継続時間。 */
const COPIED_LABEL_MS = 2000;

export default function WorkListScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ id?: string }>();

  // 新規作成の最初の保存（POST）で id が確定する。以降の保存は PUT に
  // 切り替わるよう、確定した id を画面状態として持つ（custom-tier-list
  // と同じく URL は書き換えない）。
  const idParam = params.id ? Number(params.id) : null;
  const [listId, setListId] = useState<number | null>(
    idParam !== null && Number.isFinite(idParam) && idParam > 0
      ? idParam
      : null,
  );

  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  const { data: saved, isLoading: isSavedLoading } = useSavedWorkList(listId);

  const save = useSaveWorkList();
  const share = useShareWorkList();
  const unshare = useUnshareWorkList();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [works, setWorks] = useState<WorkListEntry[]>([]);
  // 未保存の変更があるか。保存ボタンの活性と「保存済み」表示の出し分けに使う。
  const [isDirty, setIsDirty] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSourceRef = useRef({ listId, title, description, works });
  useEffect(() => {
    saveSourceRef.current = { listId, title, description, works };
  });
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  // 保存済みデータで状態を差し替える。編集中（isDirty）は上書きしない
  // （custom-tier-list と同じく、effect での同期 setState を避けるため
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
      setTitle(saved.title);
      setDescription(saved.description ?? "");
      setWorks(
        saved.items.map((item) => ({
          id: item.annictWorkId,
          title: item.title,
          imageUrl: item.hostedImageUrl,
        })),
      );
    } else {
      setTitle("");
      setDescription("");
      setWorks([]);
    }
    setIsDirty(false);
  }

  const editingDisabled = isSharing || save.isPending;

  const markDirty = useCallback(() => setIsDirty(true), []);

  const handleChangeTitle = useCallback(
    (next: string) => {
      if (editingDisabled) return;
      setTitle(next);
      markDirty();
    },
    [editingDisabled, markDirty],
  );

  const handleChangeDescription = useCallback(
    (next: string) => {
      if (editingDisabled) return;
      setDescription(next);
      markDirty();
    },
    [editingDisabled, markDirty],
  );

  // 検索シートから選ばれた作品を末尾に追加する。
  // シートの onAdd は TierItem（imageUrl が optional）で渡ってくるため
  // ここで WorkListEntry の形に寄せる。
  const handleAddWork = useCallback(
    (work: TierItem) => {
      if (editingDisabled) return;
      setWorks((prev) =>
        prev.some((w) => w.id === work.id)
          ? prev
          : [
              ...prev,
              {
                id: work.id,
                title: work.title,
                imageUrl: work.imageUrl ?? null,
              },
            ],
      );
      markDirty();
    },
    [editingDisabled, markDirty],
  );

  const handleRemoveWork = useCallback(
    (workId: number) => {
      if (editingDisabled) return;
      setWorks((prev) => prev.filter((w) => w.id !== workId));
      markDirty();
    },
    [editingDisabled, markDirty],
  );

  const handleMoveWork = useCallback(
    (workId: number, direction: -1 | 1) => {
      if (editingDisabled) return;
      setWorks((prev) => {
        const index = prev.findIndex((w) => w.id === workId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) {
          return prev;
        }
        const next = [...prev];
        const [moved] = next.splice(index, 1);
        if (moved === undefined) return prev;
        next.splice(nextIndex, 0, moved);
        return next;
      });
      markDirty();
    },
    [editingDisabled, markDirty],
  );

  const handleBack = useCallback(() => {
    const goBack = () => {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace("/work-lists");
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

  // 詳細取得の完了前に保存すると空の内容で全置換し、既存の作品が消える。
  // 404（削除済み）のリストも PUT が失敗するだけなので、id 指定では
  // saved が確定するまで保存・共有を開始させない（custom-tier-list と同じ）。
  const savedMissing = listId !== null && !isSavedLoading && !saved;
  const inputDisabled =
    isSavedLoading || savedMissing || title.trim().length === 0;
  const saveDisabled = !isDirty || save.isPending || inputDisabled;
  const shareDisabled = isSharing || save.isPending || inputDisabled;

  const saveWorkListData = useCallback(async () => {
    const cur = saveSourceRef.current;
    const savedData = await save.mutateAsync({
      id: cur.listId ?? undefined,
      title: cur.title,
      description: cur.description,
      items: cur.works.map((w) => ({ annictWorkId: w.id })),
    });
    setListId(savedData.id);
    setIsDirty(false);
    return savedData;
  }, [save]);

  const handleSave = useCallback(() => {
    // ボタン無効化とは別に中側でも弾く（読み込み完了を待たずに
    // 空の内容で全置換されるのを防ぐ）。
    if (saveDisabled) return;
    save.mutate(
      {
        id: listId ?? undefined,
        title,
        description,
        items: works.map((w) => ({ annictWorkId: w.id })),
      },
      {
        onSuccess: (data) => {
          setListId(data.id);
          setIsDirty(false);
        },
      },
    );
  }, [save, saveDisabled, listId, title, description, works]);

  // 共有は「保存された内容」を公開するため、未保存変更があっても
  // 先に保存してからトークンを発行する（custom-tier-list と同じ流れ）。
  const handleShare = useCallback(async () => {
    if (shareDisabled) return;
    setIsSharing(true);
    try {
      const savedData = await saveWorkListData();
      await share.mutateAsync(savedData.id);
    } catch {
      alert("共有に失敗しました", "時間をおいて再度お試しください。", {
        okLabel: "OK",
      });
    }
    // React Compiler は finally 句を持つ try を最適化対象にできないため、
    // catch 側で必ず握りつぶす形にして finally を避ける（react-doctor）。
    setIsSharing(false);
  }, [shareDisabled, saveWorkListData, share]);

  const handleCopyUrl = useCallback(async (url: string) => {
    try {
      await Clipboard.setStringAsync(url);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopied(true);
      copiedTimerRef.current = setTimeout(
        () => setCopied(false),
        COPIED_LABEL_MS,
      );
    } catch {
      alert("コピーできませんでした", "URL を長押しして選択してください。", {
        okLabel: "OK",
      });
    }
  }, []);

  const handleRevoke = useCallback(() => {
    if (listId === null) return;
    const id = listId;
    confirm(
      "共有を解除",
      "この URL では作品リストを見られなくなります。解除しますか？",
      () => {
        void unshare.mutateAsync(id).catch(() =>
          alert("解除できませんでした", "時間をおいて再度お試しください。", {
            okLabel: "OK",
          }),
        );
      },
      { confirmLabel: "解除", cancelLabel: "キャンセル", destructive: true },
    );
  }, [listId, unshare]);

  // リスト内の作品を #348 の作成画面へ引き継ぐ。作品は検索追加時点で
  // annict_works にキャッシュ済みなので、未保存の並びでも解決できる。
  const handleCreateTierList = useCallback(() => {
    if (works.length === 0) return;
    router.push({
      pathname: "/custom-tier-list",
      params: { workIds: works.map((w) => w.id).join(",") },
    });
  }, [works, router]);

  const shareToken = saved?.shareToken ?? null;
  const shareUrl = shareToken
    ? buildWorkListShareUrl(shareToken, apiUrl)
    : null;
  const existingWorkIds = new Set(works.map((w) => w.id));

  // 戻るボタンはネイティブヘッダー側（issue #395 Phase 2）。headerLeft を
  // 自前で出すのは、未保存時の確認ダイアログ付き handleBack と
  // E2E が参照する testID を維持するため。
  const screenOptions = (
    <Stack.Screen
      options={{
        title: "作品リスト",
        headerBackVisible: false,
        headerLeft: () => (
          <BackButton
            onPress={handleBack}
            accessibilityLabel="戻る"
            testID="work-list-back"
          />
        ),
      }}
    />
  );

  if (isConnectionLoading) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["bottom"]}
      >
        {screenOptions}
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isConnected) {
    // 作品の検索・追加は Annict トークン必須。未連携では作品を集められない
    // ため、連携誘導を最優先で出す（custom-tier-list と同じ）。
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["bottom"]}
      >
        {screenOptions}
        <AnnictSoftGate
          description="作品リストには Annict との連携が必要です。連携すると作品を検索して追加できます。"
          surface="work_list"
          testID="work-list-soft-gate"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {screenOptions}
      <View className="w-full max-w-2xl flex-1 self-center px-6 pb-4 pt-4">
        <View className="mb-3 flex-row items-center justify-end">
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              className={`rounded-lg px-4 py-2 ${
                shareDisabled
                  ? "bg-indigo-300 dark:bg-indigo-800"
                  : "bg-indigo-500"
              }`}
              onPress={handleShare}
              disabled={shareDisabled}
              accessibilityRole="button"
              accessibilityLabel="作品リストを共有"
              accessibilityState={{ disabled: shareDisabled }}
              testID="work-list-share"
            >
              {isSharing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text className="text-sm font-semibold text-white">共有</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              className={`rounded-lg px-4 py-2 ${
                saveDisabled
                  ? "bg-indigo-300 dark:bg-indigo-800"
                  : "bg-indigo-600"
              }`}
              onPress={handleSave}
              disabled={saveDisabled}
              accessibilityRole="button"
              accessibilityLabel="作品リストを保存"
              accessibilityState={{ disabled: saveDisabled }}
              testID="work-list-save"
            >
              {save.isPending ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text className="text-sm font-semibold text-white">
                  {isDirty ? "保存" : "保存済み"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
        {save.isError && (
          <Text className="mb-2 text-center text-xs text-red-500 dark:text-red-400">
            保存に失敗しました
          </Text>
        )}

        {/* タイトルはリスト名そのもの。保存の前提（空不可・50 文字）を
            入力側に置く（custom-tier-list と同じ考え方）。 */}
        <Input
          value={title}
          onChangeText={handleChangeTitle}
          placeholder="リスト名（例: 必修アニメリスト）"
          maxLength={TITLE_MAX_LENGTH}
          testID="work-list-title"
          className="rounded-lg border border-slate-300 p-3 text-base text-slate-900 dark:border-slate-600 dark:text-slate-100"
        />
        <Input
          value={description}
          onChangeText={handleChangeDescription}
          placeholder="説明（任意）"
          maxLength={DESCRIPTION_MAX_LENGTH}
          multiline
          numberOfLines={2}
          testID="work-list-description"
          className="mt-2 rounded-lg border border-slate-300 p-3 text-base text-slate-900 dark:border-slate-600 dark:text-slate-100"
        />

        {isSavedLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={colors.textMuted} />
            <Text className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              作品リストを読み込んでいます
            </Text>
          </View>
        ) : (
          <FlatList
            className="mt-3 flex-1"
            data={works}
            keyExtractor={(item) => String(item.id)}
            ListEmptyComponent={
              <Text className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
                作品がありません。下の「作品を追加」から検索して追加できます
              </Text>
            }
            renderItem={({ item, index }) => (
              <View
                className="flex-row items-center gap-3 border-b border-slate-100 py-2 dark:border-slate-800"
                testID={`work-list-item-${item.id}`}
              >
                <Text className="w-6 text-right text-sm font-semibold text-slate-400 dark:text-slate-500">
                  {index + 1}
                </Text>
                <WorkThumbnail uri={item.imageUrl} width={36} height={50} />
                <Text
                  className="flex-1 text-sm text-slate-900 dark:text-slate-100"
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                {/* 並べ替えはドラッグではなく上下ボタン。web / native で
                    同じ操作系にし、長いリストでも確実に動かせるようにする。 */}
                <TouchableOpacity
                  onPress={() => handleMoveWork(item.id, -1)}
                  disabled={editingDisabled || index === 0}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}を上に移動`}
                  testID={`work-list-move-up-${item.id}`}
                  className="p-1"
                >
                  <Ionicons
                    name="chevron-up"
                    size={18}
                    color={
                      editingDisabled || index === 0
                        ? colors.textFaint
                        : colors.primary
                    }
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleMoveWork(item.id, 1)}
                  disabled={editingDisabled || index === works.length - 1}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}を下に移動`}
                  testID={`work-list-move-down-${item.id}`}
                  className="p-1"
                >
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={
                      editingDisabled || index === works.length - 1
                        ? colors.textFaint
                        : colors.primary
                    }
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleRemoveWork(item.id)}
                  disabled={editingDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}をリストから外す`}
                  testID={`work-list-remove-${item.id}`}
                  className="p-1"
                >
                  <Ionicons name="close" size={18} color={colors.danger} />
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        <TouchableOpacity
          className="mt-3 items-center rounded-lg border border-slate-300 py-3 dark:border-slate-600"
          onPress={() => setAddSheetOpen(true)}
          disabled={editingDisabled}
          accessibilityRole="button"
          accessibilityLabel="作品を追加"
          testID="work-list-add"
        >
          <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            ＋ 作品を追加
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`mt-2 items-center rounded-lg border py-3 ${
            works.length === 0
              ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/50"
              : "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
          }`}
          onPress={handleCreateTierList}
          disabled={works.length === 0}
          accessibilityRole="button"
          accessibilityLabel="このリストで Tier 表を作る"
          accessibilityState={{ disabled: works.length === 0 }}
          testID="work-list-create-tier"
        >
          <Text className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            このリストで Tier 表を作る
          </Text>
        </TouchableOpacity>

        {/* 共有 URL（発行済みのときだけ表示。視聴履歴の共有と同じ方式） */}
        {shareUrl ? (
          <View className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <Text className="mb-1 text-xs text-slate-500 dark:text-slate-400">
              共有 URL（知っている人は誰でもリストを見られます）
            </Text>
            <Text
              className="mb-2 text-xs text-slate-900 dark:text-slate-100"
              numberOfLines={1}
              testID="work-list-share-url"
            >
              {shareUrl}
            </Text>
            <View className="flex-row gap-2">
              <TouchableOpacity
                className="flex-1 items-center rounded-lg border border-indigo-200 bg-indigo-50 py-1.5 dark:border-indigo-800 dark:bg-indigo-950"
                onPress={() => void handleCopyUrl(shareUrl)}
                accessibilityRole="button"
                accessibilityLabel="共有 URL をコピー"
                testID="work-list-share-copy"
              >
                <Text className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
                  {copied ? "コピーしました" : "コピー"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 items-center rounded-lg bg-red-50 py-1.5 dark:bg-red-950"
                onPress={handleRevoke}
                disabled={unshare.isPending}
                accessibilityRole="button"
                accessibilityLabel="共有 URL を解除"
                testID="work-list-share-revoke"
              >
                <Text className="text-xs text-red-500 dark:text-red-400">
                  解除
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>

      <WorkAddSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onAdd={handleAddWork}
        existingWorkIds={existingWorkIds}
        heading="作品を追加"
        description="タイトルで検索してリストの末尾に追加できます。並び順はあとから変更できます"
      />
    </SafeAreaView>
  );
}
