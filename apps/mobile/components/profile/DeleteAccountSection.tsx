import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { useDeleteAccount } from "@/lib/useProfile";
import { confirm } from "@/lib/dialog";
import { annictTokenStorage } from "@/lib/annict/storage";
import { queryClient } from "@/lib/queryClient";
import { useThemeColors } from "@/lib/theme";

type Props = {
  /** 削除失敗時のメッセージを表示側（トースト等）に渡す。 */
  onError: (message: string) => void;
};

/**
 * アカウント削除セクション（App Store / Google Play 審査要件）。
 * 確認ダイアログ二段階 → DELETE /me → 端末内キャッシュ・トークンの片付け →
 * サインアウトまでをここに閉じ込め、画面側はエラー表示だけを受け持つ。
 */
export function DeleteAccountSection({ onError }: Props) {
  const deleteAccount = useDeleteAccount();
  const { signOut } = useAuth();
  const colors = useThemeColors();

  // アカウント削除は取り消せないため、dialog 基盤で二段階確認にする。
  // 成功したら端末内のキャッシュ・Annict トークンも片付けてサインアウトする
  // （削除済みユーザーの JWT が残ったまま API を叩き続けないようにするため）。
  function onPressDelete() {
    confirm(
      "アカウントを削除しますか？",
      "名刺・視聴履歴・お気に入り・フレンド・Tier表など、すべてのデータが削除されます。この操作は取り消せません。",
      () =>
        confirm(
          "最終確認",
          "本当にアカウントを削除しますか？削除したデータは復元できません。",
          () => {
            void runDelete();
          },
          {
            confirmLabel: "削除する",
            cancelLabel: "キャンセル",
            destructive: true,
          },
        ),
      {
        confirmLabel: "削除する",
        cancelLabel: "キャンセル",
        destructive: true,
      },
    );
  }

  async function runDelete() {
    try {
      await deleteAccount.mutateAsync();
    } catch (e) {
      onError(
        e instanceof Error ? e.message : "アカウントの削除に失敗しました",
      );
      return;
    }
    // 削除済みアカウントのデータを端末に残さない。
    queryClient.clear();
    await annictTokenStorage.remove().catch(() => {});
    await signOut();
  }

  return (
    <View className="mt-10 border-t border-gray-200 dark:border-slate-700 px-4 pt-6">
      <TouchableOpacity
        className="items-center rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 py-3"
        onPress={onPressDelete}
        disabled={deleteAccount.isPending}
        accessibilityRole="button"
        accessibilityLabel="アカウントを削除"
      >
        {deleteAccount.isPending ? (
          <ActivityIndicator color={colors.danger} />
        ) : (
          <Text className="font-semibold text-red-600 dark:text-red-400">
            アカウントを削除
          </Text>
        )}
      </TouchableOpacity>
      <Text className="mt-2 text-center text-xs text-gray-400 dark:text-slate-500">
        削除するとすべてのデータが失われ、元に戻せません
      </Text>
    </View>
  );
}
