import { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import * as Clipboard from "expo-clipboard";
import { apiUrl } from "@/lib/apiUrl";
import { alert, confirm } from "@/lib/dialog";
import {
  buildWatchHistoryShareUrl,
  useShareWatchHistory,
  useUnshareWatchHistory,
  useWatchHistoryShareStatus,
} from "@/lib/useWatchHistoryShare";
import { useThemeColors } from "@/lib/theme";

const COPIED_LABEL_MS = 2000;

/**
 * 視聴履歴の共有 URL（AI に渡す用）の発行・コピー・解除の導線（issue #236）。
 * #170 のタブ再編で視聴履歴画面が移動しても貼り替えられるよう、
 * 画面にはこのコンポーネントを置くだけにする。
 */
export function WatchHistoryShareSection() {
  const colors = useThemeColors();
  const { data, isLoading } = useWatchHistoryShareStatus();
  const share = useShareWatchHistory();
  const unshare = useUnshareWatchHistory();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const shareToken = data?.shareToken ?? null;
  const shareUrl = shareToken
    ? buildWatchHistoryShareUrl(shareToken, apiUrl)
    : null;
  const busy = share.isPending || unshare.isPending;

  async function onCreate() {
    try {
      await share.mutateAsync();
    } catch {
      alert("作成できませんでした", "時間をおいて再度お試しください。", {
        okLabel: "OK",
      });
    }
  }

  async function onCopy() {
    if (!shareUrl) return;
    try {
      await Clipboard.setStringAsync(shareUrl);
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
  }

  function onRevoke() {
    confirm(
      "共有を解除",
      "この URL では視聴履歴を読めなくなります。解除しますか？",
      () => {
        void unshare.mutateAsync().catch(() =>
          alert("解除できませんでした", "時間をおいて再度お試しください。", {
            okLabel: "OK",
          }),
        );
      },
      { confirmLabel: "解除", cancelLabel: "キャンセル", destructive: true },
    );
  }

  if (isLoading) return null;

  return (
    <View className="px-4 pb-3" testID="watch-history-share-section">
      {shareUrl === null ? (
        <TouchableOpacity
          className="border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 rounded-lg px-3 py-2 items-center"
          onPress={onCreate}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="AI に渡す URL を作る"
          testID="watch-history-share-create"
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text className="text-xs text-indigo-600 dark:text-indigo-300 font-medium">
              AI に渡す URL を作る
            </Text>
          )}
        </TouchableOpacity>
      ) : (
        <View className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
          <Text className="text-xs text-slate-500 dark:text-slate-400 mb-1">
            AI に渡す URL（知っている人は誰でも履歴を読めます）
          </Text>
          <Text
            className="text-xs text-slate-900 dark:text-slate-100 mb-2"
            numberOfLines={1}
            testID="watch-history-share-url"
          >
            {shareUrl}
          </Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              className="flex-1 bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg py-1.5 items-center"
              onPress={onCopy}
              accessibilityRole="button"
              accessibilityLabel="共有 URL をコピー"
              testID="watch-history-share-copy"
            >
              <Text className="text-xs text-indigo-600 dark:text-indigo-300 font-medium">
                {copied ? "コピーしました" : "コピー"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 bg-red-50 dark:bg-red-950 rounded-lg py-1.5 items-center"
              onPress={onRevoke}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="共有 URL を解除"
              testID="watch-history-share-revoke"
            >
              <Text className="text-xs text-red-500 dark:text-red-400">
                解除
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
