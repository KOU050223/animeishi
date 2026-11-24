import { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useFriendNote, useSaveFriendNote } from "@/lib/useFriendNote";
import { alert } from "@/lib/dialog";
import { FriendNoteSheet } from "./FriendNoteSheet";

/**
 * 名刺帳の私用メモ（issue #659）。相手の詳細（公開プロフィール）で
 * フレンドにだけ出すセクション。メモは API が本人にしか返さないため、
 * ここでも相手・第三者には見えない。フレンド以外には呼び出し側が
 * 出さない前提（API も 404 を返す）。
 */
export function FriendNoteSection({ uid }: { uid: string }) {
  const { t } = useTranslation();
  const note = useFriendNote(uid);
  const save = useSaveFriendNote();
  const [editing, setEditing] = useState(false);

  function onSubmit(body: string) {
    save.mutate(
      { friendId: uid, body },
      {
        onSuccess: () => setEditing(false),
        // 保存失敗時はシートを開いたまま入力を残す
        onError: () =>
          alert(
            t("メモを保存できませんでした"),
            t("メモの保存に失敗しました"),
            { okLabel: "OK" },
          ),
      },
    );
  }

  const body = note.data?.body;

  return (
    <View className="mt-6 w-full self-start" testID="friend-note-section">
      <Text className="text-sm font-semibold text-secondary">{t("メモ")}</Text>
      <Text className="text-xs text-muted mt-0.5">
        {t("自分だけが見えるメモです")}
      </Text>
      <TouchableOpacity
        className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3"
        onPress={() => setEditing(true)}
        accessibilityRole="button"
        accessibilityLabel={body ? t("メモを編集") : t("メモを追加")}
        testID="friend-note-edit-button"
      >
        {body ? (
          <Text className="text-secondary">{body}</Text>
        ) : (
          <Text className="text-muted">{t("メモを追加")}</Text>
        )}
      </TouchableOpacity>
      <FriendNoteSheet
        visible={editing}
        initialValue={body ?? ""}
        saving={save.isPending}
        onClose={() => setEditing(false)}
        onSubmit={onSubmit}
      />
    </View>
  );
}
