import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { MEISHI_TEMPLATES } from "@/lib/meishi/templates";
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
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
        }}
      >
        <View
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 16,
            maxHeight: "90%",
            width: "100%",
            maxWidth: 480,
            overflow: "hidden",
          }}
        >
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" }}>
            <Text style={{ fontSize: 16, fontWeight: "bold" }}>{title}</Text>
            {warningMessage ? (
              <Text style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>
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
                    borderColor: "#e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    gap: 8,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${tpl.name}テンプレートを選ぶ`}
                >
                  <Text style={{ fontSize: 14, fontWeight: "600" }}>
                    {tpl.emoji} {tpl.name}
                  </Text>
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
          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: "#e5e7eb" }}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              style={{
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: "#e5e7eb",
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "600", color: "#111827" }}>閉じる</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
