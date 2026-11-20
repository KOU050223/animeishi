import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { Input } from "@/components/ui";
import { useThemeColors } from "@/lib/theme";
import {
  FRIEND_THANKS_BODY_MAX_LENGTH,
  THANKS_PRESET_KEYS,
  THANKS_PRESET_TEXT,
} from "@/lib/useFriendThanks";
import type { ThanksPresetKey } from "@/lib/useFriendThanks";

/**
 * 名刺交換後のお礼（issue #694）の送信シート。
 * 定型文を 1 つ選び（必須）、任意で 1 行（60 文字まで・改行不可）を
 * 添えて送る。定型文はキーで保存され、受け手の言語で表示される。
 */
export function FriendThanksSheet({
  visible,
  sending = false,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  /** 送信処理中。true の間はボタンを無効化する。 */
  sending?: boolean;
  onClose: () => void;
  onSubmit: (presetKey: ThanksPresetKey, body: string | null) => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [presetKey, setPresetKey] = useState<ThanksPresetKey | null>(null);
  const [body, setBody] = useState("");
  // シートが開くたびに入力を初期状態に戻す（前回の送信内容を残さない）。
  // effect での同期 setState を避けるため、前回値との比較でレンダー中に
  // リセットする（FriendNoteSheet と同じやり方）。
  const [prevVisible, setPrevVisible] = useState(visible);
  if (prevVisible !== visible) {
    setPrevVisible(visible);
    if (visible) {
      setPresetKey(null);
      setBody("");
    }
  }

  function submit() {
    if (!presetKey) return;
    onSubmit(presetKey, body.trim() ? body.trim() : null);
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
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              // Modal は全画面を覆うため下端はホームインジケータまで届く。
              // 固定 32 ではホームインジケータ領域に掛かるので inset を足す
              // （issue #462。タブバーではなくウィンドウの inset を使う）。
              paddingBottom: 32 + (initialWindowMetrics?.insets.bottom ?? 0),
              width: "100%",
              maxWidth: 560,
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
              {t("お礼を送る")}
            </Text>
            <Text
              style={{
                fontSize: 12,
                marginBottom: 12,
                color: colors.textMuted,
              }}
            >
              {t("同じ相手には 1 日 1 通まで送れます")}
            </Text>
            <View style={{ gap: 8 }} testID="thanks-preset-list">
              {THANKS_PRESET_KEYS.map((key) => {
                const selected = presetKey === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setPresetKey(key)}
                    accessibilityRole="button"
                    accessibilityLabel={t(THANKS_PRESET_TEXT[key])}
                    accessibilityState={{ selected }}
                    testID={`thanks-preset-${key}`}
                    style={{
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      borderRadius: 8,
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      backgroundColor: selected
                        ? colors.surfaceMuted
                        : colors.surface,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: selected ? "600" : "400",
                        color: colors.text,
                      }}
                    >
                      {t(THANKS_PRESET_TEXT[key])}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Input
              value={body}
              onChangeText={setBody}
              maxLength={FRIEND_THANKS_BODY_MAX_LENGTH}
              // 1 行だけの任意入力（改行不可・60 文字まで）。
              placeholder={t("ひとこと添える（任意）")}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                padding: 12,
                marginTop: 12,
                fontSize: 16,
                color: colors.text,
              }}
            />
            <Text
              style={{
                fontSize: 12,
                marginTop: 4,
                textAlign: "right",
                color: colors.textMuted,
              }}
            >
              {body.length}/{FRIEND_THANKS_BODY_MAX_LENGTH}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t("キャンセル")}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: colors.surfaceMuted,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "600", color: colors.text }}>
                  {t("キャンセル")}
                </Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={sending || !presetKey}
                accessibilityRole="button"
                accessibilityLabel={t("送信")}
                accessibilityState={{ disabled: sending || !presetKey }}
                testID="thanks-send-button"
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: colors.primary,
                  alignItems: "center",
                  opacity: sending || !presetKey ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "600", color: colors.onPrimary }}>
                  {sending ? t("送信中…") : t("送信")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
