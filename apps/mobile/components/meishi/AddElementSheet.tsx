import { Modal, Pressable, Text, View } from "react-native";
import type { MeishiElementType } from "@/lib/meishi/types";

type Item = { type: MeishiElementType; label: string; emoji: string; sub?: string };

const ITEMS: Item[] = [
  { type: "text", label: "テキスト", emoji: "🔤" },
  { type: "image", label: "画像", emoji: "🖼️", sub: "アップロード" },
  { type: "shape", label: "図形", emoji: "⬛", sub: "矩形・円" },
  { type: "qr", label: "QR", emoji: "🔳" },
  { type: "animeCollage", label: "視聴コラージュ", emoji: "🎬" },
  { type: "animeCountBadge", label: "視聴数バッジ", emoji: "🏷️" },
];

export function AddElementSheet({
  visible,
  onClose,
  onPick,
  onPickAvatarImage,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (type: MeishiElementType) => void;
  onPickAvatarImage?: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: "#ffffff",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            padding: 16,
            paddingBottom: 32,
            width: "100%",
            maxWidth: 560,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "bold", marginBottom: 12 }}>
            要素を追加
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {onPickAvatarImage ? (
              <PickButton
                emoji="👤"
                label="アバター"
                sub="プロフィール画像"
                onPress={onPickAvatarImage}
              />
            ) : null}
            {ITEMS.map((it) => (
              <PickButton
                key={it.type}
                emoji={it.emoji}
                label={it.label}
                sub={it.sub}
                onPress={() => onPick(it.type)}
              />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PickButton({
  emoji,
  label,
  sub,
  onPress,
}: {
  emoji: string;
  label: string;
  sub?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: "30%",
        aspectRatio: 1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#e5e7eb",
        alignItems: "center",
        justifyContent: "center",
        padding: 8,
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}を追加`}
    >
      <Text style={{ fontSize: 26 }}>{emoji}</Text>
      <Text style={{ fontSize: 12, fontWeight: "600", marginTop: 4 }}>{label}</Text>
      {sub ? <Text style={{ fontSize: 10, color: "#6b7280" }}>{sub}</Text> : null}
    </Pressable>
  );
}
