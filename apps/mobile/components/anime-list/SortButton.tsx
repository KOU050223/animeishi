import { useTranslation } from "react-i18next";
import { Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { selectionAccessibilityProps } from "@/lib/accessibility";
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
  const { t } = useTranslation();
  const styles = useAnimeListStyles();
  const palette = useAnimeListPalette();
  const iconColor = active ? palette.title : palette.subtitle;
  return (
    <TouchableOpacity
      style={[styles.sortButton, active && styles.sortButtonActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        order === "asc"
          ? t("{{label}} 昇順", { label })
          : order === "desc"
            ? t("{{label}} 降順", { label })
            : label
      }
      accessibilityState={{ selected: active }}
      {...selectionAccessibilityProps(active)}
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
