import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { MeishiElementType } from "@/lib/meishi/types";
import { useThemeColors } from "@/lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

export type AddElementSheetProps = {
  visible: boolean;
  onClose: () => void;
  onPick: (type: MeishiElementType) => void;
  onPickAvatarImage?: () => void;
  onPickAnimeImage?: () => void;
};

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
  {
    type: "achievementBadge",
    label: "実績バッジ",
    icon: "medal-outline",
    sub: "獲得した実績を表示",
  },
];

/**
 * 要素追加シートの中身。シートの器（ネイティブは BottomSheet、Web は
 * エディタ内オーバーレイ）はプラットフォーム側が持つ。
 * onClose を渡すとタイトル行に明示的な閉じるボタンを表示する
 * （スワイプ・スクリムで閉じられない器向け）。
 */
export function AddElementSheetContent({
  onPick,
  onPickAvatarImage,
  onPickAnimeImage,
  onClose,
}: Pick<
  AddElementSheetProps,
  "onPick" | "onPickAvatarImage" | "onPickAnimeImage"
> & {
  onClose?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        padding: 16,
        paddingBottom: 32,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: 16,
            fontWeight: "bold",
            color: colors.text,
          }}
        >
          要素を追加
        </Text>
        {onClose ? (
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="閉じる"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
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
