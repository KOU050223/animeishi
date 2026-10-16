import { useCallback, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import type { ShareTierListUrl, UseTierUrlShare } from "./types";
import { copyTierListUrl } from "./sheet";
import { canShareImageFile, downloadImageFile, shareImageFile } from "./image";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";

function buildXIntentUrl(url: string, text?: string): string {
  const params = new URLSearchParams({ url });
  if (text) params.set("text", text);
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

type ImagePhase = "idle" | "generating" | "ready";

/**
 * Web: 共有モーダル。URL を表示し [Xで共有] / [URLをコピー] をボタン操作で
 * 実行する。自動呼び出しだとブラウザのユーザー操作期限で拒否されるため、
 * 各アクションはモーダル内のクリックに委ねる。
 *
 * 画像共有も同じ制約があるため「画像を生成」→ 完了後に「画像を共有 /
 * 画像をダウンロード」の別ボタンを出す 2 段階にしている
 * （生成待ちの後に navigator.share を呼ぶと操作期限切れで失敗する）。
 */
function TierUrlShareModal({
  url,
  tweetText,
  generateImageFile,
  onClose,
}: {
  url: string;
  tweetText?: string;
  generateImageFile?: () => Promise<File>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [imagePhase, setImagePhase] = useState<ImagePhase>("idle");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const handleShareX = () => {
    // Web モーダル内の共有方式選択を計測する（issue #214）。
    trackEvent("tier_share", { [TRACK_EVENT_KEYS.method]: "x" });
    window.open(
      buildXIntentUrl(url, tweetText),
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleCopy = async () => {
    trackEvent("tier_share", { [TRACK_EVENT_KEYS.method]: "copy" });
    try {
      await copyTierListUrl(url);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };

  const handleGenerateImage = async () => {
    if (!generateImageFile || imagePhase === "generating") return;
    setImagePhase("generating");
    setImageError(null);
    try {
      setImageFile(await generateImageFile());
      setImagePhase("ready");
    } catch {
      setImagePhase("idle");
      setImageError("画像の生成に失敗しました");
    }
  };

  const handleShareImage = async () => {
    if (!imageFile) return;
    trackEvent("tier_share", { [TRACK_EVENT_KEYS.method]: "image" });
    try {
      // 生成済み File をこのクリック内で渡すため操作期限は切れない
      await shareImageFile(imageFile, tweetText ?? imageFile.name);
      onClose();
    } catch {
      setImageError("共有に失敗しました。ダウンロードをお試しください。");
    }
  };

  const handleDownloadImage = () => {
    if (!imageFile) return;
    // 画像の保存（ダウンロード）を計測する（issue #214）。
    trackEvent("tier_image_save");
    downloadImageFile(imageFile);
  };

  const shareable = imageFile != null && canShareImageFile(imageFile);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 dark:bg-black/70 px-6">
        <View
          className="w-full max-w-sm gap-3 rounded-2xl bg-white dark:bg-slate-800 p-5"
          accessibilityViewIsModal
        >
          <Text className="text-base font-bold text-gray-900 dark:text-slate-100">
            Tier 表を共有
          </Text>
          <Text
            selectable
            className="rounded bg-gray-100 dark:bg-slate-700 p-2 text-xs text-gray-700 dark:text-slate-200"
          >
            {url}
          </Text>
          <Pressable
            onPress={handleShareX}
            className="items-center rounded-lg bg-gray-900 dark:bg-slate-100 px-4 py-2.5"
            accessibilityRole="button"
          >
            <Text className="text-sm font-semibold text-white dark:text-slate-900">
              Xで共有
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void handleCopy()}
            className="items-center rounded-lg border border-gray-300 dark:border-slate-600 px-4 py-2.5"
            accessibilityRole="button"
          >
            <Text className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {copied ? "コピーしました" : "URLをコピー"}
            </Text>
          </Pressable>
          {copyFailed && (
            <Text className="text-xs text-red-600 dark:text-red-400">
              コピーに失敗しました。URL を選択してコピーしてください。
            </Text>
          )}
          {generateImageFile &&
            (imagePhase === "ready" && imageFile ? (
              <>
                <Text className="text-xs text-gray-500 dark:text-slate-400">
                  画像を生成しました。
                  {shareable
                    ? "共有またはダウンロードで保存できます。"
                    : "ダウンロードで保存できます。"}
                </Text>
                {shareable && (
                  <Pressable
                    onPress={() => void handleShareImage()}
                    className="items-center rounded-lg bg-gray-900 dark:bg-slate-100 px-4 py-2.5"
                    accessibilityRole="button"
                  >
                    <Text className="text-sm font-semibold text-white dark:text-slate-900">
                      画像を共有
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={handleDownloadImage}
                  className="items-center rounded-lg border border-gray-300 dark:border-slate-600 px-4 py-2.5"
                  accessibilityRole="button"
                >
                  <Text className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    画像をダウンロード
                  </Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={() => void handleGenerateImage()}
                disabled={imagePhase === "generating"}
                className={`items-center rounded-lg border border-gray-300 dark:border-slate-600 px-4 py-2.5${imagePhase === "generating" ? " opacity-50" : ""}`}
                accessibilityRole="button"
              >
                <Text className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  {imagePhase === "generating" ? "画像を生成中…" : "画像を生成"}
                </Text>
              </Pressable>
            ))}
          {imageError && (
            <Text className="text-xs text-red-600 dark:text-red-400">
              {imageError}
            </Text>
          )}
          <Pressable
            onPress={onClose}
            className="items-center px-4 py-2"
            accessibilityRole="button"
          >
            <Text className="text-sm text-gray-500 dark:text-slate-400">
              閉じる
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export const useTierUrlShare: UseTierUrlShare = ({
  tweetText,
  generateImageFile,
} = {}) => {
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
          generateImageFile={generateImageFile}
          onClose={() => setModalUrl(null)}
        />
      ),
  };
};
