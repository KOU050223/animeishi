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
          ? `${title}をお気に入りから解除`
          : `${title}をお気に入りに追加`
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
