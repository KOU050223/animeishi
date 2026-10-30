import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { MenuPicker } from "@/components/ui/menu-picker";
import { useAnimeListStyles } from "./animeListStyles";
import {
  SEASON_FILTER_ALL,
  SEASON_KEYS,
  SEASONS,
  seasonPickerYears,
  selectableSeasonKeys,
  type SeasonFilterKey,
  type SeasonKey,
} from "./animeListUtils";

// 「通年」チップのラベル。期チップの先頭に置く（その年の 4 クール全部。issue #346）。
const SEASON_CHIP_KEYS = [SEASON_FILTER_ALL, ...SEASON_KEYS] as const;

const SEASON_CHIP_LABELS: Record<SeasonFilterKey, string> = {
  [SEASON_FILTER_ALL]: "通年",
  winter: SEASONS.winter,
  spring: SEASONS.spring,
  summer: SEASONS.summer,
  autumn: SEASONS.autumn,
};

// allowAllYear で season/onChange の型を分岐させる（判別共用体）。
// false（既定）の呼び出し側は SeasonKey のまま使え、通年チップは出ない。
type SeasonFilterProps = { year: number } & (
  | {
      /** 通年チップを出さない（既定）。季節単位の画面（tier 表）向け。 */
      allowAllYear?: false;
      season: SeasonKey;
      onChange: (year: number, season: SeasonKey) => void;
    }
  | {
      /** 「通年」チップを出す（issue #346）。 */
      allowAllYear: true;
      season: SeasonFilterKey;
      onChange: (year: number, season: SeasonFilterKey) => void;
    }
);

/**
 * 年×シーズンの絞り込み。年は選択肢が多い（Annict アーカイブ全期間 +
 * 来期・再来期）ためピッカー、シーズンはチップで選ぶ。
 * ピッカーはネイティブでは @expo/ui の純正メニュー、Web では従来の
 * モーダル一覧に切り替わる（issue #313）。
 * 今期+2 シーズンより先の期は選べない（Annict 側も未登録のため）。
 * allowAllYear 時は先頭に「通年」チップを出す。その年に選べる期が
 * 1 つでもあれば選べる（未登録の期は API 側で単に 0 件になる）。
 * 検索バーに語が入っているときは title 検索が優先されるため、呼び出し側で
 * このフィルタを隠す（season は無視されるため）。
 */
export function SeasonFilter(props: SeasonFilterProps) {
  const { year, season } = props;
  const styles = useAnimeListStyles();
  const years = seasonPickerYears();
  const selectable = selectableSeasonKeys(year);
  const seasonChips: readonly SeasonFilterKey[] = props.allowAllYear
    ? SEASON_CHIP_KEYS
    : SEASON_KEYS;

  const selectYear = (nextYear: number) => {
    // 通年はどの年でも選べるためそのまま引き継ぐ（allowAllYear 時のみ来る）。
    if (season === SEASON_FILTER_ALL) {
      if (props.allowAllYear) props.onChange(nextYear, SEASON_FILTER_ALL);
      return;
    }
    // 遷移先の年で選択中の期が選べない場合（例: 秋→上限年）、
    // その年で選べる最後の期に寄せる。
    const keys = selectableSeasonKeys(nextYear);
    const nextSeason = keys.includes(season)
      ? season
      : (keys[keys.length - 1] ?? season);
    props.onChange(nextYear, nextSeason);
  };

  const selectSeason = (key: SeasonFilterKey) => {
    if (key === SEASON_FILTER_ALL) {
      if (props.allowAllYear) props.onChange(year, key);
      return;
    }
    props.onChange(year, key);
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
        {/* 5 択でも狭い画面・文字拡大でははみ出すため横スクロールを残す。 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {seasonChips.map((key) => {
            const active = key === season;
            // 通年はその年に選べる期が 1 つでもあれば選べる。
            const disabled =
              key === SEASON_FILTER_ALL
                ? selectable.length === 0
                : !selectable.includes(key);
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.filterChip,
                  active && styles.filterChipActive,
                  disabled && styles.filterChipDisabled,
                ]}
                onPress={() => selectSeason(key)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled }}
                accessibilityLabel={`${SEASON_CHIP_LABELS[key]}で絞り込む`}
                testID={`season-filter-season-${key}`}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                    disabled && styles.filterChipTextDisabled,
                  ]}
                >
                  {SEASON_CHIP_LABELS[key]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
