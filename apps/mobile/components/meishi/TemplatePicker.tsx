import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MEISHI_TEMPLATES } from "@/lib/meishi/templates";
import { useThemeColors } from "@/lib/theme";
import { useTranslation } from "react-i18next";
import type { TranslationKey } from "@/lib/i18n/keys";
import { MeishiRenderer } from "./MeishiRenderer";

const templateNameKeys: Record<string, TranslationKey> = {
  blank: "白紙",
  classic: "クラシック",
  sunset: "サンセット",
  midnight: "ミッドナイト",
  sakura: "さくら",
};

const templatePaletteKeys: Record<string, TranslationKey> = {
  blank: "白",
  classic: "白",
  sunset: "オレンジとコーラル",
  midnight: "紺と紫",
  sakura: "淡いピンクの濃淡",
};

export function TemplatePicker({
  visible,
  onClose,
  onPick,
  title = "テンプレートを選ぶ",
  warningMessage,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (templateId: string) => void;
  title?: string;
  warningMessage?: string;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.scrim,
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
        }}
      >
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            maxHeight: "90%",
            width: "100%",
            maxWidth: 480,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text
              style={{ fontSize: 16, fontWeight: "bold", color: colors.text }}
            >
              {t(title as TranslationKey)}
            </Text>
            {warningMessage ? (
              <Text
                style={{ fontSize: 12, color: colors.danger, marginTop: 4 }}
              >
                {warningMessage}
              </Text>
            ) : null}
          </View>
          <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
            {MEISHI_TEMPLATES.map((tpl) => {
              const doc = tpl.build();
              return (
                <Pressable
                  key={tpl.id}
                  onPress={() => onPick(tpl.id)}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    padding: 12,
                    gap: 8,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    "{{name}}テンプレートを選ぶ。配色: {{colors}}",
                    {
                      name: t(templateNameKeys[tpl.id] ?? "テンプレート"),
                      colors: t(templatePaletteKeys[tpl.id] ?? "白"),
                    },
                  )}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Ionicons
                      name={tpl.icon}
                      size={16}
                      color={colors.textMuted}
                    />
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: colors.text,
                      }}
                    >
                      {t(templateNameKeys[tpl.id] ?? "テンプレート")}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      height: 18,
                      borderRadius: 6,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      testID={`template-swatch-${tpl.id}-start`}
                      style={{
                        flex: 1,
                        backgroundColor:
                          doc.canvas.background.kind === "gradient"
                            ? doc.canvas.background.from
                            : doc.canvas.background.kind === "solid"
                              ? doc.canvas.background.color
                              : doc.canvas.background.base,
                      }}
                    />
                    <View
                      testID={`template-swatch-${tpl.id}-end`}
                      style={{
                        flex: 1,
                        backgroundColor:
                          doc.canvas.background.kind === "gradient"
                            ? doc.canvas.background.to
                            : doc.canvas.background.kind === "solid"
                              ? doc.canvas.background.color
                              : doc.canvas.background.accent,
                      }}
                    />
                  </View>
                  <MeishiRenderer
                    document={doc}
                    context={{
                      profile: {
                        username: t("サンプル"),
                        bio: t("自己紹介テキスト"),
                        favoriteQuote: t("「好きなセリフ」"),
                        profileUrl: "https://example.com",
                      },
                    }}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          <View
            style={{
              padding: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("閉じる")}
              style={{
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.surfaceMuted,
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "600", color: colors.text }}>
                {t("閉じる")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
