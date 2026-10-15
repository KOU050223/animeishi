import { Modal, Pressable, Text, View } from "react-native";
import type { MeishiElementType } from "@/lib/meishi/types";
import { useThemeColors } from "@/lib/theme";

type Item = {
  type: MeishiElementType;
  label: string;
  emoji: string;
  sub?: string;
};

const ITEMS: Item[] = [
  { type: "text", label: "テキスト", emoji: "🔤" },
  { type: "image", label: "画像", emoji: "🖼️", sub: "端末からアップロード" },
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
  onPickAnimeImage,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (type: MeishiElementType) => void;
  onPickAvatarImage?: () => void;
  onPickAnimeImage?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
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
            paddingBottom: 32,
            width: "100%",
            maxWidth: 560,
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: "bold",
              marginBottom: 12,
              color: colors.text,
            }}
          >
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
            {onPickAnimeImage ? (
              <PickButton
                emoji="🎞️"
                label="アニメ画像"
                sub="Annict 検索/リスト"
                onPress={onPickAnimeImage}
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
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: "30%",
        aspectRatio: 1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        padding: 8,
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}を追加`}
    >
      <Text style={{ fontSize: 26 }}>{emoji}</Text>
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          marginTop: 4,
          color: colors.text,
        }}
      >
        {label}
      </Text>
      {sub ? (
        <Text style={{ fontSize: 10, color: colors.textMuted }}>{sub}</Text>
      ) : null}
    </Pressable>
  );
}
