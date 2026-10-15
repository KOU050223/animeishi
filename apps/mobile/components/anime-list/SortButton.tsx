import { Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SortOrder } from "@/lib/useAnimeList";
import { useAnimeListPalette, useAnimeListStyles } from "./animeListStyles";

export function SortButton({
  label,
  icon,
  active,
  order,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  order: SortOrder | null;
  onPress: () => void;
}) {
  const styles = useAnimeListStyles();
  const palette = useAnimeListPalette();
  const iconColor = active ? palette.title : palette.subtitle;
  return (
    <TouchableOpacity
      style={[styles.sortButton, active && styles.sortButtonActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${order === "asc" ? " 昇順" : order === "desc" ? " 降順" : ""}`}
      accessibilityState={{ selected: active }}
    >
      <Ionicons name={icon} size={14} color={iconColor} />
      <Text style={[styles.sortText, active && styles.sortTextActive]}>
        {label}
      </Text>
      {order ? (
        <Ionicons
          name={order === "asc" ? "arrow-up" : "arrow-down"}
          size={13}
          color={iconColor}
        />
      ) : null}
    </TouchableOpacity>
  );
}
