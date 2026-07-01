import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { styles } from "./animeListStyles";
import {
  SEASON_KEYS,
  SEASONS,
  recentYears,
  type SeasonKey,
} from "./animeListUtils";

/**
 * 年×シーズンの絞り込みチップ。年は新しい順、シーズンは冬→春→夏→秋で並ぶ。
 * 検索バーに語が入っているときは title 検索が優先されるため、呼び出し側で
 * このフィルタを隠す（season は無視されるため）。
 */
export function SeasonFilter({
  year,
  season,
  onChangeYear,
  onChangeSeason,
}: {
  year: number;
  season: SeasonKey;
  onChangeYear: (year: number) => void;
  onChangeSeason: (season: SeasonKey) => void;
}) {
  const years = recentYears();

  return (
    <View style={styles.filterBar}>
      <View style={styles.filterRow}>
        <Text style={styles.filterRowLabel}>年</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {years.map((y) => {
            const active = y === year;
            return (
              <TouchableOpacity
                key={y}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => onChangeYear(y)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${y}年で絞り込む`}
                testID={`season-filter-year-${y}`}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {y}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.filterRow}>
        <Text style={styles.filterRowLabel}>期</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {SEASON_KEYS.map((key) => {
            const active = key === season;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => onChangeSeason(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${SEASONS[key]}で絞り込む`}
                testID={`season-filter-season-${key}`}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {SEASONS[key]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
