import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { MenuPicker } from "@/components/ui/menu-picker";
import { useAnimeListStyles } from "./animeListStyles";
import {
  SEASON_KEYS,
  SEASONS,
  seasonPickerYears,
  selectableSeasonKeys,
  type SeasonKey,
} from "./animeListUtils";

/**
 * 年×シーズンの絞り込み。年は選択肢が多い（Annict アーカイブ全期間 +
 * 来期・再来期）ためピッカー、シーズンは 4 択のチップで選ぶ。
 * ピッカーはネイティブでは @expo/ui の純正メニュー、Web では従来の
 * モーダル一覧に切り替わる（issue #313）。
 * 今期+2 シーズンより先の期は選べない（Annict 側も未登録のため）。
 * 検索バーに語が入っているときは title 検索が優先されるため、呼び出し側で
 * このフィルタを隠す（season は無視されるため）。
 */
export function SeasonFilter({
  year,
  season,
  onChange,
}: {
  year: number;
  season: SeasonKey;
  /** 年・期のどちらの操作でも (year, season) のペアで返す。 */
  onChange: (year: number, season: SeasonKey) => void;
}) {
  const styles = useAnimeListStyles();
  const years = seasonPickerYears();
  const selectable = selectableSeasonKeys(year);

  const selectYear = (nextYear: number) => {
    // 遷移先の年で選択中の期が選べない場合（例: 秋→上限年）、
    // その年で選べる最後の期に寄せる。
    const keys = selectableSeasonKeys(nextYear);
    const nextSeason = keys.includes(season)
      ? season
      : (keys[keys.length - 1] ?? season);
    onChange(nextYear, nextSeason);
  };

  return (
    <View style={styles.filterBar}>
      <View style={styles.filterRow}>
        <Text style={styles.filterRowLabel}>年</Text>
        <MenuPicker
          testID="season-filter-year"
          accessibilityLabel="年を選択"
          title="年を選択"
          closeAccessibilityLabel="年の選択を閉じる"
          selectedValue={year}
          options={years.map((y) => ({
            label: `${y}年`,
            value: y,
            accessibilityLabel: `${y}年で絞り込む`,
          }))}
          onValueChange={selectYear}
        />
      </View>

      <View style={styles.filterRow}>
        <Text style={styles.filterRowLabel}>期</Text>
        {/* 4 択でも狭い画面・文字拡大でははみ出すため横スクロールを残す。 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {SEASON_KEYS.map((key) => {
            const active = key === season;
            const disabled = !selectable.includes(key);
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.filterChip,
                  active && styles.filterChipActive,
                  disabled && styles.filterChipDisabled,
                ]}
                onPress={() => onChange(year, key)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled }}
                accessibilityLabel={`${SEASONS[key]}で絞り込む`}
                testID={`season-filter-season-${key}`}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                    disabled && styles.filterChipTextDisabled,
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
