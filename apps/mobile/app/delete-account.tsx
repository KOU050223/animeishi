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
import { clearMeishiDocument, loadMeishiLibrary } from "@/lib/meishi/storage";
import { queryClient } from "@/lib/queryClient";
import { useThemeColors } from "@/lib/theme";
import {
  submitDeletionFeedback,
  useDeleteAccount,
  useDeletionSummary,
} from "@/lib/useProfile";

type Step = "reason" | "summary" | "confirm";

// 理由の POST の完了待ち上限。数秒で打ち切って削除は続行する。
const FEEDBACK_TIMEOUT_MS = 3000;

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

type SummaryRow = { label: string; count: number };

// ① 退会理由。任意入力なので「スキップ」も置く。
function ReasonStep({
  selectedReasons,
  onToggleReason,
  freeText,
  onChangeFreeText,
  onNext,
}: {
  selectedReasons: Set<ReasonKey>;
  onToggleReason: (key: ReasonKey) => void;
  freeText: string;
  onChangeFreeText: (text: string) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const reasonLabels: Record<ReasonKey, string> = {
    missing_features: t("欲しい機能がない"),
    hard_to_use: t("使い方が分からない"),
    too_many_notifications: t("通知が多い"),
    other_users: t("他のユーザーとのトラブル"),
    privacy_concern: t("個人データを残したくない"),
    not_using: t("あまり使っていない"),
    other: t("その他"),
  };

  return (
    <View className="gap-4">
      <View>
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t("よろしければ、退会の理由を教えてください")}
        </Text>
        <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {t("回答は任意です。今後の改善の参考にします（匿名で送信されます）")}
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
              onPress={() => onToggleReason(key)}
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
        onChangeText={onChangeFreeText}
        placeholder={t("その他の理由（自由記述）")}
        multiline
        numberOfLines={3}
        maxLength={500}
        className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-slate-900 dark:text-slate-100"
        accessibilityLabel={t("その他の理由を入力")}
      />

      <Button
        label={t("次へ")}
        onPress={onNext}
        accessibilityLabel={t("次へ")}
        testID="delete-account-next"
      />
      <TouchableOpacity
        onPress={onNext}
        accessibilityRole="button"
        accessibilityLabel={t("スキップ")}
        className="py-2"
      >
        <Text className="text-center text-sm text-slate-400 dark:text-slate-500">
          {t("スキップ")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ② 消えるデータの件数。読み込み中は「次へ」を無効にする。
// 取得失敗時は再試行を出しつつ、審査要件（アプリ内で削除できること）を
// 満たすため先へは進める。その場合は最終確認で件数未確認を明示する。
function SummaryStep({
  rows,
  isLoading,
  isError,
  onRetry,
  onNext,
}: {
  rows: SummaryRow[] | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <View className="gap-4">
      <View>
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t("削除されるデータ")}
        </Text>
        <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {t("アカウントを削除すると、以下のデータがすべて失われます")}
        </Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : isError || !rows ? (
        <View className="items-center gap-3 py-4">
          <Text className="text-center text-red-500 dark:text-red-400">
            {t("削除対象データの取得に失敗しました")}
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-6 py-3"
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t("削除対象データを再取得")}
          >
            <Text className="font-semibold text-white">{t("再試行")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4">
          {rows.map((row, i) => (
            <View
              key={row.label}
              className={`flex-row items-center justify-between py-3 ${
                i > 0 ? "border-t border-slate-100 dark:border-slate-800" : ""
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
        onPress={onNext}
        loading={isLoading}
        accessibilityLabel={t("次へ")}
        testID="delete-account-summary-next"
      />
    </View>
  );
}

// ③ 最終確認。件数を確認できなかった場合はその旨も明示する。
function ConfirmStep({
  countsUnavailable,
  deleting,
  onDelete,
}: {
  countsUnavailable: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="gap-4">
      <View>
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t("最終確認")}
        </Text>
        <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("本当にアカウントを削除しますか？この操作は取り消せません。")}
        </Text>
        {countsUnavailable && (
          <Text className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {t("消えるデータの件数を確認できませんでした")}
          </Text>
        )}
      </View>

      <Button
        label={t("削除する")}
        variant="destructive"
        onPress={onDelete}
        loading={deleting}
        accessibilityLabel={t("削除する")}
        testID="delete-account-confirm"
      />
    </View>
  );
}

/**
 * アカウント削除の段階フロー（issue #426）。
 * ① 退会理由（複数選択＋自由記述・任意）→ ② 消えるデータの件数 →
 * ③ 最終確認 → DELETE /me → 端末内データの片付け → サインアウト。
 * 審査要件の削除導線そのものは DeleteAccountSection からの push 遷移で維持する。
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut, getToken } = useAuth();
  const [step, setStep] = useState<Step>("reason");
  const [selectedReasons, setSelectedReasons] = useState<Set<ReasonKey>>(
    new Set(),
  );
  const [freeText, setFreeText] = useState("");
  const [meishiCount, setMeishiCount] = useState(0);
  const summary = useDeletionSummary();
  const deleteAccount = useDeleteAccount();

  useEffect(() => {
    void loadMeishiLibrary().then((library) =>
      setMeishiCount(library?.cards.length ?? 0),
    );
  }, []);

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

  // 理由の POST は削除直前に送る。DELETE が先に完了すると tombstone で
  // 後続の POST が 401 になり回答が失われるため、送信を遅らせて
  // 削除前に完了を待つ。遅らせる分、戻って編集された最新の回答が
  // 一度だけ送られる形になる。
  async function submitFeedbackWithTimeout() {
    const reasons = [...selectedReasons];
    const text = freeText.trim();
    if (reasons.length === 0 && text.length === 0) {
      return;
    }
    const sent = submitDeletionFeedback(getToken, {
      reasons,
      ...(text.length > 0 ? { freeText: text } : {}),
    }).catch(() => {});
    await Promise.race([
      sent,
      new Promise((resolve) => setTimeout(resolve, FEEDBACK_TIMEOUT_MS)),
    ]);
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
    // 理由の保存失敗・タイムアウトで退会をブロックしない（issue #426 の要件）。
    await submitFeedbackWithTimeout();
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

  const summaryRows: SummaryRow[] | null = summary.data
    ? [
        { label: t("視聴履歴"), count: summary.data.watchHistories },
        { label: t("お気に入り"), count: summary.data.favorites },
        { label: t("フレンド"), count: summary.data.friends },
        { label: t("Tier 表"), count: summary.data.tierLists },
        { label: t("作品リスト"), count: summary.data.workLists },
        { label: t("名刺"), count: meishiCount },
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
          <ReasonStep
            selectedReasons={selectedReasons}
            onToggleReason={toggleReason}
            freeText={freeText}
            onChangeFreeText={setFreeText}
            onNext={() => setStep("summary")}
          />
        )}
        {step === "summary" && (
          <SummaryStep
            rows={summaryRows}
            isLoading={summary.isLoading}
            isError={summary.isError}
            onRetry={() => summary.refetch()}
            onNext={() => setStep("confirm")}
          />
        )}
        {step === "confirm" && (
          <ConfirmStep
            countsUnavailable={!summary.data}
            deleting={deleteAccount.isPending}
            onDelete={() => void runDelete()}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
