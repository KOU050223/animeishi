import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MEISHI_TEMPLATES } from "@/lib/meishi/templates";
import { useThemeColors } from "@/lib/theme";
import { MeishiRenderer } from "./MeishiRenderer";

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
              {title}
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
                  accessibilityLabel={`${tpl.name}テンプレートを選ぶ`}
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
                      {tpl.name}
                    </Text>
                  </View>
                  <MeishiRenderer
                    document={doc}
                    context={{
                      profile: {
                        username: "サンプル",
                        bio: "自己紹介テキスト",
                        favoriteQuote: "「好きなセリフ」",
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
              accessibilityLabel="閉じる"
              style={{
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.surfaceMuted,
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "600", color: colors.text }}>
                閉じる
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
