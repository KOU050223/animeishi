import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
  Pressable,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Button, Input } from "@/components/ui";
import {
  useSocialLinks,
  useSaveSocialLinks,
  SOCIAL_LINK_KINDS,
} from "@/lib/socialLinks";
import type {
  SocialLinkInput,
  SocialLinkKind,
  SocialLinkVisibility,
} from "@/lib/socialLinks";
import { socialLinkLabel } from "@/components/profile/SocialLinksList";

const VISIBILITIES: SocialLinkVisibility[] = ["public", "friends", "private"];

export default function SocialLinksScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useSocialLinks();
  const save = useSaveSocialLinks();
  const [draft, setDraft] = useState<SocialLinkInput[] | null>(null);
  const [error, setError] = useState(false);
  const items = draft ?? data?.items ?? [];

  function update(index: number, patch: Partial<SocialLinkInput>) {
    setDraft(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...items];
    const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    setDraft(next);
  }

  async function onSave() {
    setError(false);
    try {
      await save.mutateAsync(
        items.map((item) => ({ ...item, value: item.value.trim() })),
      );
      router.back();
    } catch {
      setError(true);
    }
  }

  return (
    <SafeAreaView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      edges={["bottom"]}
    >
      <Stack.Screen options={{ title: t("SNS リンク") }} />
      {isLoading ? (
        <ActivityIndicator className="mt-8" />
      ) : isError ? (
        <Pressable
          onPress={() => {
            void refetch();
          }}
          className="p-6"
          accessibilityRole="button"
        >
          <Text className="text-red-600">
            {t("SNS リンクの取得に失敗しました。再試行")}
          </Text>
        </Pressable>
      ) : (
        <ScrollView contentContainerClassName="px-4 py-6 pb-12 gap-4">
          <Text className="text-sm text-slate-600 dark:text-slate-300">
            {t("リンクごとに公開範囲を選べます。既定は交換した相手だけです。")}
          </Text>
          {items.map((item, index) => (
            <View
              key={index}
              className="rounded-xl bg-white dark:bg-slate-900 p-4 gap-3"
            >
              <View className="flex-row flex-wrap gap-2">
                {SOCIAL_LINK_KINDS.map((kind: SocialLinkKind) => (
                  <Pressable
                    key={kind}
                    onPress={() => update(index, { kind, value: "" })}
                    accessibilityRole="button"
                    className={`rounded-full px-3 py-2 ${item.kind === kind ? "bg-indigo-600" : "bg-slate-100 dark:bg-slate-800"}`}
                  >
                    <Text
                      className={
                        item.kind === kind
                          ? "text-white"
                          : "text-slate-800 dark:text-slate-200"
                      }
                    >
                      {socialLinkLabel(kind)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Input
                value={item.value}
                onChangeText={(value) => update(index, { value })}
                placeholder={
                  item.kind === "other" ? "https://" : t("ユーザー ID")
                }
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={
                  item.kind === "other" ? t("URL") : t("ユーザー ID")
                }
              />
              <View className="flex-row flex-wrap gap-2">
                {VISIBILITIES.map((visibility) => (
                  <Pressable
                    key={visibility}
                    onPress={() => update(index, { visibility })}
                    accessibilityRole="button"
                    className={`rounded-lg px-3 py-2 ${item.visibility === visibility ? "bg-indigo-600" : "bg-slate-100 dark:bg-slate-800"}`}
                  >
                    <Text
                      className={
                        item.visibility === visibility
                          ? "text-white"
                          : "text-slate-800 dark:text-slate-200"
                      }
                    >
                      {visibility === "public"
                        ? t("全体公開")
                        : visibility === "friends"
                          ? t("交換した相手だけ")
                          : t("非公開")}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View className="flex-row gap-4">
                <Pressable
                  onPress={() => move(index, -1)}
                  disabled={index === 0}
                  accessibilityRole="button"
                >
                  <Text className="text-indigo-600">{t("上へ")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  accessibilityRole="button"
                >
                  <Text className="text-indigo-600">{t("下へ")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDraft(items.filter((_, i) => i !== index))}
                  accessibilityRole="button"
                >
                  <Text className="text-red-600">{t("削除")}</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <Pressable
            onPress={() =>
              setDraft([
                ...items,
                { kind: "x", value: "", visibility: "friends" },
              ])
            }
            disabled={items.length >= 20}
            accessibilityRole="button"
            className="rounded-xl border border-indigo-500 px-4 py-3 items-center"
          >
            <Text className="text-indigo-600 dark:text-indigo-400">
              {t("リンクを追加")}
            </Text>
          </Pressable>
          {error ? (
            <Text className="text-red-600">
              {t(
                "SNS リンクの保存に失敗しました。入力内容を確認してください。",
              )}
            </Text>
          ) : null}
          <Button
            label={t("保存")}
            onPress={() => {
              void onSave();
            }}
            loading={save.isPending}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
