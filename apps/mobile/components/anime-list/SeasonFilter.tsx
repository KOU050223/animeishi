import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAnimeListPalette, useAnimeListStyles } from "./animeListStyles";
import {
  SEASON_KEYS,
  SEASONS,
  seasonPickerYears,
  selectableSeasonKeys,
  type SeasonKey,
} from "./animeListUtils";

// 年ピッカーの 1 行の高さ。getItemLayout と合わせるため固定値にする。
const YEAR_ITEM_HEIGHT = 44;

/**
 * 年×シーズンの絞り込み。年は選択肢が多い（Annict アーカイブ全期間 +
 * 来期・再来期）ためボトムシート型のピッカー、シーズンは 4 択のチップで選ぶ。
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
  const palette = useAnimeListPalette();
  const [pickerOpen, setPickerOpen] = useState(false);
  const years = seasonPickerYears();
  const selectable = selectableSeasonKeys(year);
  const selectedYearIndex = years.indexOf(year);

  const selectYear = (nextYear: number) => {
    setPickerOpen(false);
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
        <TouchableOpacity
          style={styles.yearPickerButton}
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="年を選択"
          testID="season-filter-year-button"
        >
          <Text style={styles.yearPickerButtonText}>{year}年</Text>
          <Ionicons name="chevron-down" size={14} color={palette.chipText} />
        </TouchableOpacity>
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

      <Modal
        transparent
        visible={pickerOpen}
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={styles.yearPickerBackdrop}
          onPress={() => setPickerOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="年の選択を閉じる"
        >
          <Pressable style={styles.yearPickerSheet} onPress={() => {}}>
            <Text style={styles.yearPickerTitle}>年を選択</Text>
            <ScrollView
              // 年リストは 100 件強と軽いため全描画し、選択中の年が
              // 見える位置に初期スクロールする。
              contentOffset={{
                x: 0,
                y: Math.max(selectedYearIndex, 0) * YEAR_ITEM_HEIGHT,
              }}
            >
              {years.map((y) => {
                const active = y === year;
                return (
                  <TouchableOpacity
                    key={y}
                    style={[
                      styles.yearPickerItem,
                      active && styles.yearPickerItemActive,
                    ]}
                    onPress={() => selectYear(y)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${y}年で絞り込む`}
                    testID={`season-filter-year-option-${y}`}
                  >
                    <Text
                      style={[
                        styles.yearPickerItemText,
                        active && styles.yearPickerItemTextActive,
                      ]}
                    >
                      {y}年
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
