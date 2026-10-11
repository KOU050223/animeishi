import { useCallback, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import type { ShareTierListUrl, UseTierUrlShare } from "./types";
import { copyTierListUrl } from "./sheet";

function buildXIntentUrl(url: string, text?: string): string {
  const params = new URLSearchParams({ url });
  if (text) params.set("text", text);
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

/**
 * Web: 共有モーダル。URL を表示し [Xで共有] / [URLをコピー] をボタン操作で
 * 実行する。自動呼び出しだとブラウザのユーザー操作期限で拒否されるため、
 * 各アクションはモーダル内のクリックに委ねる。
 */
function TierUrlShareModal({
  url,
  tweetText,
  onClose,
}: {
  url: string;
  tweetText?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleShareX = () => {
    window.open(
      buildXIntentUrl(url, tweetText),
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleCopy = async () => {
    try {
      await copyTierListUrl(url);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View
          className="w-full max-w-sm gap-3 rounded-2xl bg-white p-5"
          accessibilityViewIsModal
        >
          <Text className="text-base font-bold text-gray-900">
            Tier 表を共有
          </Text>
          <Text
            selectable
            className="rounded bg-gray-100 p-2 text-xs text-gray-700"
          >
            {url}
          </Text>
          <Pressable
            onPress={handleShareX}
            className="items-center rounded-lg bg-gray-900 px-4 py-2.5"
            accessibilityRole="button"
          >
            <Text className="text-sm font-semibold text-white">Xで共有</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleCopy()}
            className="items-center rounded-lg border border-gray-300 px-4 py-2.5"
            accessibilityRole="button"
          >
            <Text className="text-sm font-semibold text-gray-900">
              {copied ? "コピーしました" : "URLをコピー"}
            </Text>
          </Pressable>
          {copyFailed && (
            <Text className="text-xs text-red-600">
              コピーに失敗しました。URL を選択してコピーしてください。
            </Text>
          )}
          <Pressable
            onPress={onClose}
            className="items-center px-4 py-2"
            accessibilityRole="button"
          >
            <Text className="text-sm text-gray-500">閉じる</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export const useTierUrlShare: UseTierUrlShare = ({ tweetText } = {}) => {
  const [modalUrl, setModalUrl] = useState<string | null>(null);

  const shareUrl = useCallback<ShareTierListUrl>(async (url) => {
    setModalUrl(url);
    return "shared";
  }, []);

  return {
    shareUrl,
    urlShareElement:
      modalUrl == null ? null : (
        <TierUrlShareModal
          url={modalUrl}
          tweetText={tweetText}
          onClose={() => setModalUrl(null)}
        />
      ),
  };
};
