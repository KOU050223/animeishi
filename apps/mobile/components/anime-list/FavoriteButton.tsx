import { useTranslation } from "react-i18next";
import { TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { selectionAccessibilityProps } from "@/lib/accessibility";
import { useAnimeListPalette, useAnimeListStyles } from "./animeListStyles";

export function FavoriteButton({
  isFavorite,
  disabled,
  onPress,
  title,
}: {
  isFavorite: boolean;
  disabled: boolean;
  onPress: () => void;
  title: string;
}) {
  const { t } = useTranslation();
  const styles = useAnimeListStyles();
  const palette = useAnimeListPalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.favoriteButton, isFavorite && styles.favoriteButtonActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: isFavorite, disabled }}
      {...selectionAccessibilityProps(isFavorite)}
      accessibilityLabel={t("{{title}}の推し登録を切り替える", { title })}
    >
      <Ionicons
        name={isFavorite ? "heart" : "heart-outline"}
        size={21}
        color={isFavorite ? palette.favoriteIconActive : palette.favoriteIcon}
      />
    </TouchableOpacity>
  );
}
