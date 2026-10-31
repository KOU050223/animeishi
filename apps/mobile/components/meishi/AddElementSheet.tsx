import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { MeishiElementType } from "@/lib/meishi/types";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useThemeColors } from "@/lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

type Item = {
  type: MeishiElementType;
  label: string;
  icon: IconName;
  sub?: string;
};

const ITEMS: Item[] = [
  { type: "text", label: "テキスト", icon: "text-outline" },
  {
    type: "image",
    label: "画像",
    icon: "image-outline",
    sub: "端末からアップロード",
  },
  { type: "shape", label: "図形", icon: "square-outline", sub: "矩形・円" },
  { type: "qr", label: "QR", icon: "qr-code-outline" },
  { type: "animeCollage", label: "視聴コラージュ", icon: "film-outline" },
  { type: "animeCountBadge", label: "視聴数バッジ", icon: "pricetag-outline" },
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
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scrimAccessibilityLabel="要素の追加をやめる"
    >
      <View
        style={{
          padding: 16,
          paddingBottom: 32,
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
              icon="person-outline"
              label="アバター"
              sub="プロフィール画像"
              onPress={onPickAvatarImage}
            />
          ) : null}
          {onPickAnimeImage ? (
            <PickButton
              icon="images-outline"
              label="アニメ画像"
              sub="Annict 検索/リスト"
              onPress={onPickAnimeImage}
            />
          ) : null}
          {ITEMS.map((it) => (
            <PickButton
              key={it.type}
              icon={it.icon}
              label={it.label}
              sub={it.sub}
              onPress={() => onPick(it.type)}
            />
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

function PickButton({
  icon,
  label,
  sub,
  onPress,
}: {
  icon: IconName;
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
      <Ionicons name={icon} size={26} color={colors.text} />
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
