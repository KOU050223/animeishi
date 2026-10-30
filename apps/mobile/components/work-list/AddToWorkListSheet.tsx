import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui";
import { alert } from "@/lib/dialog";
import { useThemeColors } from "@/lib/theme";
import {
  useAddWorkToWorkList,
  useSaveWorkList,
  useWorkListsContaining,
} from "@/lib/workList/useWorkLists";

/**
 * 「リストに追加」シートの対象作品。アニメ一覧のカード（issue #377）や
 * 視聴履歴の行（issue #379）など、開き元が違っても使えるよう、
 * 追加に必要な最小限の情報だけを要求する。
 */
export type AddToWorkListTarget = {
  annictWorkId: number;
  title: string;
};

// API のタイトル上限（workListSaveSchema.max(50)）と揃える。
const TITLE_MAX_LENGTH = 50;

/** 追加先リストの 1 行。追加済みは選択不可にして表示で分かるようにする。 */
function WorkListRow({
  item,
  added,
  pending,
  disabled,
  onAdd,
}: {
  item: { id: number; title: string; itemCount: number };
  added: boolean;
  pending: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onAdd}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        added
          ? t("{{title}}は追加済み", { title: item.title })
          : t("{{title}}に追加", { title: item.title })
      }
      accessibilityState={{ disabled }}
      testID={`add-to-work-list-row-${item.id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderMuted,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, color: colors.text }} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>
          {t("{{count}} 作品", { count: item.itemCount })}
        </Text>
      </View>
      {pending ? (
        <ActivityIndicator size="small" color={colors.primaryText} />
      ) : added ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="checkmark" size={14} color={colors.success} />
          <Text
            style={{ fontSize: 13, fontWeight: "600", color: colors.textMuted }}
          >
            {t("追加済み")}
          </Text>
        </View>
      ) : (
        <Text
          style={{ fontSize: 13, fontWeight: "600", color: colors.primaryText }}
        >
          {t("追加")}
        </Text>
      )}
    </TouchableOpacity>
  );
}

/** シート下部の「新しいリストを作る」。押すとタイトル入力フォームに切り替わる。 */
function CreateListFooter({
  creating,
  newTitle,
  onChangeTitle,
  submitting,
  onStart,
  onSubmit,
}: {
  creating: boolean;
  newTitle: string;
  onChangeTitle: (value: string) => void;
  submitting: boolean;
  onStart: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const canSubmit = newTitle.trim().length > 0 && !submitting;
  if (!creating) {
    return (
      <TouchableOpacity
        onPress={onStart}
        accessibilityRole="button"
        accessibilityLabel={t("新しいリストを作る")}
        testID="add-to-work-list-create"
        style={{
          marginTop: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          paddingVertical: 10,
        }}
      >
        <Ionicons name="add" size={16} color={colors.primaryText} />
        <Text
          style={{ fontSize: 13, fontWeight: "600", color: colors.primaryText }}
        >
          {t("新しいリストを作る")}
        </Text>
      </TouchableOpacity>
    );
  }
  return (
    <View
      style={{
        marginTop: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Input
        value={newTitle}
        onChangeText={onChangeTitle}
        autoFocus
        placeholder={t("新しいリストの名前")}
        maxLength={TITLE_MAX_LENGTH}
        testID="add-to-work-list-new-title"
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          padding: 10,
          fontSize: 14,
          color: colors.text,
        }}
      />
      <TouchableOpacity
        onPress={onSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel={t("作成して追加")}
        accessibilityState={{ disabled: !canSubmit }}
        testID="add-to-work-list-create-submit"
        style={{
          backgroundColor: canSubmit ? colors.primary : colors.surfaceMuted,
          borderRadius: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        {submitting ? (
          <ActivityIndicator size="small" color={colors.onPrimary} />
        ) : (
          <Text style={{ color: colors.onPrimary, fontWeight: "600" }}>
            {t("作成して追加")}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

/** 一覧の読み込み中・取得失敗時の表示。 */
function SheetStatus({
  kind,
  onRetry,
}: {
  kind: "loading" | "error";
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <View style={{ alignItems: "center", marginTop: 24, gap: 8 }}>
      {kind === "loading" ? (
        <>
          <ActivityIndicator color={colors.textFaint} />
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            {t("読み込んでいます")}
          </Text>
        </>
      ) : (
        <>
          <Text style={{ color: colors.danger, fontSize: 13 }}>
            {t("リストを取得できませんでした")}
          </Text>
          <TouchableOpacity
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t("リストの取得を再試行")}
            testID="add-to-work-list-retry"
            style={{
              backgroundColor: colors.primary,
              borderRadius: 8,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: colors.onPrimary, fontWeight: "600" }}>
              {t("再試行")}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

/**
 * 作品を自分の作品リストに入れるシート。
 * 追加先のリストを選ぶと末尾に追加され、既に入っているリストは
 * 「追加済み」で選択不可にする。リストが無いときは、その場で
 * 新しいリストを作ってこの作品を入れられる。
 * 複数のリストに続けて入れられるよう、追加してもシートは閉じない。
 */
export function AddToWorkListSheet({
  work,
  onClose,
}: {
  /** 対象作品。null のときシートは閉じる。 */
  work: AddToWorkListTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const visible = work != null;

  // 開き直すたびに前回の追加状態・入力を引きずらないよう、
  // 開閉の変化をレンダー中に検知してリセットする（WorkAddSheet と同じ方式）。
  const [prevVisible, setPrevVisible] = useState(visible);
  const [addedIds, setAddedIds] = useState<ReadonlySet<number>>(new Set());
  const [pendingListId, setPendingListId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  if (prevVisible !== visible) {
    setPrevVisible(visible);
    if (visible) {
      setAddedIds(new Set());
      setPendingListId(null);
      setCreating(false);
      setNewTitle("");
    }
  }

  // 閉じている間（work=null）はフェッチしない。
  const lists = useWorkListsContaining(work?.annictWorkId ?? null);
  const add = useAddWorkToWorkList();
  const create = useSaveWorkList();

  // シートは同じインスタンスで対象作品が入れ替わる。前の作品の追加が
  // 非同期で解決するのは閉じた後・別作品を開いた後になり得るので、
  // 結果を現在の作品の状態にだけ反映するよう世代を確認する。
  const activeWorkIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeWorkIdRef.current = work?.annictWorkId ?? null;
  }, [work?.annictWorkId]);

  function handleAdd(listId: number) {
    if (!work || pendingListId !== null || addedIds.has(listId)) return;
    const requestWorkId = work.annictWorkId;
    const isCurrent = () => activeWorkIdRef.current === requestWorkId;
    setPendingListId(listId);
    add.mutate(
      { listId, annictWorkId: requestWorkId },
      {
        onSuccess: () => {
          if (!isCurrent()) return;
          // containsWork は一覧の再取得完了まで古いままなので、
          // このシート内で追加したリストは自分で追加済みとして覚える。
          setAddedIds((prev) => new Set(prev).add(listId));
        },
        onError: () => {
          if (!isCurrent()) return;
          alert(
            t("追加に失敗しました"),
            t("時間をおいて再度お試しください。"),
            { okLabel: t("OK") },
          );
        },
        onSettled: () => {
          if (!isCurrent()) return;
          setPendingListId(null);
        },
      },
    );
  }

  // 「新しいリストを作る」はリスト作成画面へ飛ばさず、この作品だけを
  // 入れたリストとしてその場で作る（移動すると追加元の一覧に戻れないため）。
  function handleCreate() {
    const title = newTitle.trim();
    if (!work || title.length === 0 || create.isPending) return;
    const requestWorkId = work.annictWorkId;
    const isCurrent = () => activeWorkIdRef.current === requestWorkId;
    create.mutate(
      { title, items: [{ annictWorkId: requestWorkId }] },
      {
        onSuccess: (data) => {
          if (!isCurrent()) return;
          setAddedIds((prev) => new Set(prev).add(data.id));
          setCreating(false);
          setNewTitle("");
        },
        onError: () => {
          if (!isCurrent()) return;
          alert(
            t("作成に失敗しました"),
            t("時間をおいて再度お試しください。"),
            { okLabel: t("OK") },
          );
        },
      },
    );
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: colors.scrim,
            justifyContent: "flex-end",
            alignItems: "center",
          }}
          accessibilityLabel={t("リストに追加を閉じる")}
          testID="add-to-work-list-scrim"
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              paddingBottom: 32,
              width: "100%",
              maxWidth: 560,
              // リスト数が多いときに行一覧をスクロールできるよう高さを確保する。
              height: "60%",
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "bold",
                marginBottom: 4,
                color: colors.text,
              }}
            >
              {t("リストに追加")}
            </Text>
            {work ? (
              <Text
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  marginBottom: 12,
                }}
                numberOfLines={2}
              >
                {work.title}
              </Text>
            ) : null}

            <View style={{ flex: 1 }}>
              {lists.isLoading ? (
                <SheetStatus kind="loading" />
              ) : lists.isError && lists.data === undefined ? (
                // 一度でも一覧が取れているなら、バックグラウンド再取得の失敗で
                // 内容を消さない（古い一覧でも追加操作はできる）。
                <SheetStatus kind="error" onRetry={() => lists.refetch()} />
              ) : (
                <FlatList
                  data={lists.data ?? []}
                  keyExtractor={(item) => String(item.id)}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 13,
                        textAlign: "center",
                        marginTop: 24,
                      }}
                    >
                      {t(
                        "まだリストがありません。「新しいリストを作る」から追加先を作れます",
                      )}
                    </Text>
                  }
                  renderItem={({ item }) => {
                    const added = item.containsWork || addedIds.has(item.id);
                    return (
                      <WorkListRow
                        item={item}
                        added={added}
                        pending={pendingListId === item.id}
                        disabled={added || pendingListId !== null}
                        onAdd={() => handleAdd(item.id)}
                      />
                    );
                  }}
                />
              )}
            </View>

            <CreateListFooter
              creating={creating}
              newTitle={newTitle}
              onChangeTitle={setNewTitle}
              submitting={create.isPending}
              onStart={() => setCreating(true)}
              onSubmit={handleCreate}
            />

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("閉じる")}
              testID="add-to-work-list-close"
              style={{
                marginTop: 10,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.surfaceMuted,
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "600", color: colors.text }}>
                {t("閉じる")}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
