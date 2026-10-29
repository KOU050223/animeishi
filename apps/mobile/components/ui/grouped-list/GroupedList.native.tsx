import { FieldGroup, Host, ListItem } from "@expo/ui";
import { useColorScheme } from "nativewind";
import { useWindowDimensions } from "react-native";
import type { GroupedListProps } from "./types";

// 行高さの見積もり（iOS grouped Form の行は最小 44pt、
// Android の設定行は 56dp 前後）。見出し行・セクション間余白込みの
// セクションあたりの固定分と合わせて FieldGroup の領域を決める。
// 見積もりが実際より大きい分にはリスト末尾に透過の余白が出るだけだが、
// 小さいと Form が内部スクロールを始めて外側 ScrollView と二重になるため
// やや大きめに取り、Dynamic Type の拡大分は fontScale で織り込む。
const ROW_HEIGHT = 46;
const SECTION_HEIGHT = 76;
const LIST_VERTICAL_MARGIN = 24;

/**
 * iOS/Android: @expo/ui の FieldGroup（iOS は SwiftUI Form、
 * Android は Compose の設定画面レイアウト）に載せる。
 * 行は ListItem（押下可能なネイティブ行）で、行テキストは文字列のまま
 * 渡せる（universal 層が各プラットフォームの Text に包む）。
 *
 * FieldGroup は内部でスクロールするコンテナで固有高さを持たないため、
 * matchContents な Host の中では高さが確定せず描画されない
 * （expo/expo#46203。公式 docs も「definite size の親が必要」と明記）。
 * 縦スクロールは外側の ScrollView に一本化するため、
 * 内容量から見積もった高さを Host に与える。
 */
export function GroupedList({ sections }: GroupedListProps) {
  const { colorScheme } = useColorScheme();
  const { fontScale } = useWindowDimensions();
  const rowCount = sections.reduce((sum, s) => sum + s.rows.length, 0);
  const height = Math.ceil(
    (sections.length * SECTION_HEIGHT +
      rowCount * ROW_HEIGHT +
      LIST_VERTICAL_MARGIN) *
      fontScale,
  );
  return (
    <Host style={{ width: "100%", height }} colorScheme={colorScheme}>
      <FieldGroup
        style={{ backgroundColor: "transparent" }}
        // @expo/ui/swift-ui/modifiers は iOS 専用で .native からは
        // import できないため、同等の JSON Config を直接組み立てる
        // （Android 側は未知の $type の modifier を無視する）。
        // iOS の Form は grouped 背景色を持つため、見積もり高さとの差分が
        // ベタ塗りの帯に見えないようスクロール領域の背景を消す。
        modifiers={[{ $type: "scrollContentBackground", visible: "hidden" }]}
      >
        {sections.map((section) => (
          <FieldGroup.Section key={section.key} title={section.title}>
            {section.rows.map((row) => (
              <ListItem
                key={row.key}
                onPress={row.onPress}
                testID={row.testID}
                // accessibilityLabel をネイティブ側の行へ適用する。
                modifiers={[
                  {
                    $type: "accessibilityLabel",
                    label: row.accessibilityLabel,
                  },
                ]}
              >
                {row.label}
              </ListItem>
            ))}
          </FieldGroup.Section>
        ))}
      </FieldGroup>
    </Host>
  );
}
