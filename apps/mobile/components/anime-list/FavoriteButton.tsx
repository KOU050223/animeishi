import { useTranslation } from "react-i18next";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
      accessibilityLabel={
        isFavorite
          ? t("{{title}}を推しから解除", { title })
          : t("{{title}}を推しに登録", { title })
      }
    >
      <Ionicons
        name={isFavorite ? "heart" : "heart-outline"}
        size={21}
        color={isFavorite ? palette.favoriteIconActive : palette.favoriteIcon}
      />
    </TouchableOpacity>
  );
}
