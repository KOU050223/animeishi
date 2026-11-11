import { useRef, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton, Button, Input, SegmentedControl } from "@/components/ui";
import { getAppInfo } from "@/lib/appInfo";
import { alert } from "@/lib/dialog";
import {
  FEEDBACK_BODY_MAX_LENGTH,
  type FeedbackCategory,
  useSendFeedback,
} from "@/lib/useSendFeedback";

const CATEGORIES: {
  value: FeedbackCategory;
  label: string;
  placeholder: string;
}[] = [
  {
    value: "bug",
    label: "不具合",
    placeholder:
      "どの画面で、何をしたら、どうなったかを書いてください\n例: 名刺の編集画面で保存を押すと画面が固まる",
  },
  {
    value: "request",
    label: "要望・ご意見",
    placeholder: "ほしい機能や、使いにくいところを教えてください",
  },
  {
    value: "other",
    label: "その他",
    placeholder: "ご自由にお書きください",
  },
];

function describeApp(): { appVersion: string; platform: string } {
  const info = getAppInfo();
  // Web は buildVersion を持たず、同じ version のまま何度もデプロイされるため、
  // デプロイを特定できるコミットも添える。native は同じビルドに OTA 更新が
  // 重なるため、適用中の更新 ID も添える。
  const build = info.buildVersion ? ` (${info.buildVersion})` : "";
  const commit = info.commitSha ? `+${info.commitSha.slice(0, 7)}` : "";
  const update = info.updateId ? ` ota:${info.updateId.slice(0, 8)}` : "";
  return {
    appVersion: `${info.appVersion}${build}${commit}${update}`,
    platform: [Platform.OS, Platform.Version].filter(Boolean).join(" "),
  };
}

export default function FeedbackScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [body, setBody] = useState("");
  const sendFeedback = useSendFeedback();
  // isPending は再描画まで反映されないため、連打を同期的に弾くフラグを別に持つ。
  const submitting = useRef(false);

  const current = CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0];
  const canSubmit = body.trim().length > 0 && !sendFeedback.isPending;

  // 直リンク（Web の URL 直打ち等）では履歴が無いため、ホームへ戻す。
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  const onSubmit = () => {
    if (submitting.current) return;
    submitting.current = true;
    const sentBody = body;
    sendFeedback.mutate(
      { category, body: sentBody.trim(), ...describeApp() },
      {
        onSettled: () => {
          submitting.current = false;
        },
        onSuccess: () => {
          // 送信中に追記された本文は消さない。
          setBody((current) => (current === sentBody ? "" : current));
          alert(
            "送信しました",
            "ご協力ありがとうございます。いただいた内容は開発の参考にさせていただきます。",
            { okLabel: "OK", onClose: handleBack },
          );
        },
        onError: (e) => {
          alert(
            "送信できませんでした",
            e instanceof Error ? e.message : "送信に失敗しました",
            { okLabel: "OK" },
          );
        },
      },
    );
  };

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      <Stack.Screen
        options={{
          title: "不具合報告・ご意見",
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel="戻る"
              testID="feedback-back-button"
            />
          ),
        }}
      />
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="w-full max-w-2xl self-center pb-16 pt-4"
      >
        <Text className="px-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
          アプリの不具合や、ほしい機能・ご意見をお送りください。すべて開発者が読んでいます。個別のお返事はできませんのでご了承ください。
        </Text>

        <View className="mt-4">
          <SegmentedControl
            items={CATEGORIES.map((c) => ({
              label: c.label,
              active: c.value === category,
              onPress: () => setCategory(c.value),
              testID: `feedback-category-${c.value}`,
            }))}
          />
        </View>

        <View className="mt-2 px-4">
          <Input
            value={body}
            onChangeText={setBody}
            placeholder={current.placeholder}
            multiline
            textAlignVertical="top"
            maxLength={FEEDBACK_BODY_MAX_LENGTH}
            className="min-h-40 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            accessibilityLabel="内容"
            testID="feedback-body-input"
          />
          <Text className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">
            {body.length}/{FEEDBACK_BODY_MAX_LENGTH}
          </Text>
          <Text className="mt-2 text-xs leading-5 text-slate-400 dark:text-slate-500">
            不具合の調査のため、アプリのバージョンと OS
            の情報も一緒に送信されます。
          </Text>

          <View className="mt-6">
            <Button
              label="送信する"
              icon="send-outline"
              onPress={onSubmit}
              disabled={!canSubmit}
              loading={sendFeedback.isPending}
              accessibilityLabel="不具合報告・ご意見を送信"
              testID="feedback-submit"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
