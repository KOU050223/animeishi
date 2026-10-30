import { TouchableOpacity } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/lib/theme";

/**
 * 「リストに追加」シートを開くボタン（issue #377）。
 * アニメ一覧の推し登録ボタン（FavoriteButton）と同じ丸型のアイコンボタン。
 * 置き場所ごとの見た目の微調整は style で上書きできるようにして、
 * 視聴履歴（#379）など別の面からも使い回せる形にしている。
 */
export function AddToWorkListButton({
  onPress,
  disabled,
  title,
  style,
  testID,
}: {
  onPress: () => void;
  disabled?: boolean;
  /** 対象作品のタイトル。アクセシビリティラベルに使う。 */
  title: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 18,
          backgroundColor: colors.surfaceMuted,
          borderWidth: 1,
          borderColor: colors.border,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={t("{{title}}をリストに追加", { title })}
      testID={testID}
    >
      <Ionicons name="bookmark-outline" size={18} color={colors.primaryText} />
    </TouchableOpacity>
  );
}
