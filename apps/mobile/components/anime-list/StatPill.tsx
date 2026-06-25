import { Text, View } from "react-native";
import { styles } from "./animeListStyles";

export function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ink" | "gold" | "mint";
}) {
  return (
    <View style={[styles.statPill, styles[`statPill_${tone}`]]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
