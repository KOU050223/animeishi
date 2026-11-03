import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "@clerk/expo";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton, Button, Input } from "@/components/ui";
import { alert } from "@/lib/dialog";
import { haptics } from "@/lib/haptics";
import { annictTokenStorage } from "@/lib/annict/storage";
import { clearMeishiDocument, loadMeishiDocument } from "@/lib/meishi/storage";
import { queryClient } from "@/lib/queryClient";
import { useThemeColors } from "@/lib/theme";
import {
  useDeleteAccount,
  useDeletionSummary,
  useSubmitDeletionFeedback,
} from "@/lib/useProfile";

type Step = "reason" | "summary" | "confirm";

// POST /me/deletion-feedback に送る理由の識別子。集計のキーなので
// 表示文言（label）とは分けて固定値を送る。API 側はキーの中身を
// 検証しないため、選択肢の追加・文言変更はクライアントだけで完結する。
const REASON_KEYS = [
  "missing_features",
  "hard_to_use",
  "too_many_notifications",
  "other_users",
  "privacy_concern",
  "not_using",
  "other",
] as const;
type ReasonKey = (typeof REASON_KEYS)[number];

/**
 * アカウント削除の段階フロー（issue #426）。
 * ① 退会理由（複数選択＋自由記述・任意）→ ② 消えるデータの件数 →
 * ③ 最終確認 → DELETE /me → 端末内データの片付け → サインアウト。
 * 審査要件の削除導線そのものは DeleteAccountSection からの push 遷移で維持する。
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { signOut } = useAuth();
  const [step, setStep] = useState<Step>("reason");
  const [selectedReasons, setSelectedReasons] = useState<Set<ReasonKey>>(
    new Set(),
  );
  const [freeText, setFreeText] = useState("");
  const [hasMeishi, setHasMeishi] = useState(false);
  const summary = useDeletionSummary();
  const submitFeedback = useSubmitDeletionFeedback();
  const deleteAccount = useDeleteAccount();

  useEffect(() => {
    void loadMeishiDocument().then((doc) => setHasMeishi(doc !== null));
  }, []);

  const reasonLabels: Record<ReasonKey, string> = {
    missing_features: t("欲しい機能がない"),
    hard_to_use: t("使い方が分からない"),
    too_many_notifications: t("通知が多い"),
    other_users: t("他のユーザーとのトラブル"),
    privacy_concern: t("個人データを残したくない"),
    not_using: t("あまり使っていない"),
    other: t("その他"),
  };

  function toggleReason(key: ReasonKey) {
    setSelectedReasons((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function goToSummary() {
    const reasons = [...selectedReasons];
    const text = freeText.trim();
    if (reasons.length > 0 || text.length > 0) {
      // 理由の保存失敗で退会をブロックしない。削除済みトークンでは 401 に
      // なるため DELETE /me より先に送る必要があるが、画面遷移も待たせ
      // ないので await せずエラーは握り潰す。
      submitFeedback.mutate(
        { reasons, ...(text.length > 0 ? { freeText: text } : {}) },
        { onError: () => {} },
      );
    }
    setStep("summary");
  }

  // 戻る導線はフロー内のステップを優先し、先頭では呼び出し元の
  // プロフィール画面へ戻す（blocked-users と同じ規約）。
  function handleBack() {
    if (step === "confirm") {
      setStep("summary");
      return;
    }
    if (step === "summary") {
      setStep("reason");
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/profile");
  }

  async function runDelete() {
    haptics.warning();
    try {
      await deleteAccount.mutateAsync();
    } catch (e) {
      alert(
        t("削除に失敗しました"),
        e instanceof Error ? e.message : t("アカウントの削除に失敗しました"),
        { okLabel: t("OK") },
      );
      return;
    }
    // 削除済みアカウントのデータを端末に残さない。名刺ドキュメントは
    // サーバーに無い端末内データだが、「すべてのデータが消える」と
    // 表示している以上ここで消す。
    queryClient.clear();
    await annictTokenStorage.remove().catch(() => {});
    await clearMeishiDocument().catch(() => {});
    await signOut();
  }

  const summaryRows: { label: string; count: number }[] | null = summary.data
    ? [
        { label: t("視聴履歴"), count: summary.data.watchHistories },
        { label: t("お気に入り"), count: summary.data.favorites },
        { label: t("フレンド"), count: summary.data.friends },
        { label: t("Tier 表"), count: summary.data.tierLists },
        { label: t("作品リスト"), count: summary.data.workLists },
        { label: t("名刺"), count: hasMeishi ? 1 : 0 },
      ]
    : null;

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      <Stack.Screen
        options={{
          title: t("アカウントを削除"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
              testID="delete-account-back-button"
            />
          ),
        }}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8 pt-2"
        keyboardShouldPersistTaps="handled"
      >
        {step === "reason" && (
          <View className="gap-4">
            <View>
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t("よろしければ、退会の理由を教えてください")}
              </Text>
              <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {t(
                  "回答は任意です。今後の改善の参考にします（匿名で送信されます）",
                )}
              </Text>
            </View>

            <View className="gap-2">
              {REASON_KEYS.map((key) => {
                const selected = selectedReasons.has(key);
                return (
                  <TouchableOpacity
                    key={key}
                    className={`flex-row items-center gap-3 rounded-xl border px-4 py-3 ${
                      selected
                        ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950"
                        : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    }`}
                    onPress={() => toggleReason(key)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={reasonLabels[key]}
                  >
                    <Ionicons
                      name={selected ? "checkbox" : "square-outline"}
                      size={22}
                      color={selected ? colors.primary : colors.placeholder}
                    />
                    <Text className="flex-1 text-slate-900 dark:text-slate-100">
                      {reasonLabels[key]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Input
              value={freeText}
              onChangeText={setFreeText}
              placeholder={t("その他の理由（自由記述）")}
              multiline
              numberOfLines={3}
              maxLength={500}
              className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-slate-900 dark:text-slate-100"
              accessibilityLabel={t("その他の理由を入力")}
            />

            <Button
              label={t("次へ")}
              onPress={goToSummary}
              accessibilityLabel={t("次へ")}
              testID="delete-account-next"
            />
            <TouchableOpacity
              onPress={() => setStep("summary")}
              accessibilityRole="button"
              accessibilityLabel={t("スキップ")}
              className="py-2"
            >
              <Text className="text-center text-sm text-slate-400 dark:text-slate-500">
                {t("スキップ")}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "summary" && (
          <View className="gap-4">
            <View>
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t("削除されるデータ")}
              </Text>
              <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {t("アカウントを削除すると、以下のデータがすべて失われます")}
              </Text>
            </View>

            {summary.isLoading ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : summary.isError || !summaryRows ? (
              <View className="items-center gap-3 py-4">
                <Text className="text-center text-red-500 dark:text-red-400">
                  {t("削除対象データの取得に失敗しました")}
                </Text>
                <TouchableOpacity
                  className="rounded-lg bg-indigo-600 px-6 py-3"
                  onPress={() => summary.refetch()}
                  accessibilityRole="button"
                  accessibilityLabel={t("削除対象データを再取得")}
                >
                  <Text className="font-semibold text-white">
                    {t("再試行")}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4">
                {summaryRows.map((row, i) => (
                  <View
                    key={row.label}
                    className={`flex-row items-center justify-between py-3 ${
                      i > 0
                        ? "border-t border-slate-100 dark:border-slate-800"
                        : ""
                    }`}
                  >
                    <Text className="text-slate-900 dark:text-slate-100">
                      {row.label}
                    </Text>
                    <Text className="text-sm text-slate-500 dark:text-slate-400">
                      {t("{{count}} 件", { count: row.count })}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text className="text-xs text-red-500 dark:text-red-400">
              {t("削除したデータは復元できません")}
            </Text>

            <Button
              label={t("次へ")}
              onPress={() => setStep("confirm")}
              accessibilityLabel={t("次へ")}
              testID="delete-account-summary-next"
            />
          </View>
        )}

        {step === "confirm" && (
          <View className="gap-4">
            <View>
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t("最終確認")}
              </Text>
              <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t(
                  "本当にアカウントを削除しますか？この操作は取り消せません。",
                )}
              </Text>
            </View>

            <Button
              label={t("削除する")}
              variant="destructive"
              onPress={() => void runDelete()}
              loading={deleteAccount.isPending}
              accessibilityLabel={t("削除する")}
              testID="delete-account-confirm"
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
