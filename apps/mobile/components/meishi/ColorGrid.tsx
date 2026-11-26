import { Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { selectionAccessibilityProps } from "@/lib/accessibility";
import { COLOR_PALETTE } from "@/lib/meishi/defaults";
import { useThemeColors } from "@/lib/theme";

/**
 * 色見本の横スクロール一覧。選択中の色は枠で示す。
 * Web DOM レベルでの選択状態の検証（*.web.test.tsx）のため、
 * PropertyPanel から切り出している。
 */
export function ColorGrid({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6 }}
    >
      {COLOR_PALETTE.map(({ value: c, name }) => {
        const selected = c.toLowerCase() === value.toLowerCase();
        return (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            accessibilityRole="button"
            accessibilityLabel={t(name)}
            accessibilityState={{ selected }}
            {...selectionAccessibilityProps(selected)}
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: c,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? colors.primaryBorder : colors.border,
              // 見本色と同系色の選択枠（indigo 見本など）でも選択状態が
              // 判別できるよう、間隔を空けた外側リングを足す。
              // border だけだと見本の塗りと同化する。
              outlineColor: colors.primaryBorder,
              outlineStyle: "solid",
              outlineWidth: selected ? 2 : 0,
              outlineOffset: 1,
            }}
          />
        );
      })}
    </ScrollView>
  );
}
