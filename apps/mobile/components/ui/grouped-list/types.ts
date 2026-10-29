/**
 * プラットフォーム差異を吸収するグループ化リスト（設定フォーム）の
 * 共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - GroupedList.native.tsx ... iOS/Android（@expo/ui の FieldGroup =
 *   純正のグループ化リスト。iOS は SwiftUI Form）
 * - GroupedList.web.tsx    ... Web（既存と同じ見出し + カード行構成）
 *
 * 呼び出し側は常に `@/components/ui/grouped-list` から import する。
 * 表示文言は基盤側に既定値を持たせず、必ず呼び出し側が渡す。
 */
export type GroupedListRow = {
  key: string;
  /** 行に表示する文言。 */
  label: string;
  onPress: () => void;
  /** 行のアクセシビリティラベル。 */
  accessibilityLabel: string;
  testID?: string;
};

export type GroupedListSection = {
  key: string;
  /** セクション見出し。 */
  title: string;
  rows: readonly GroupedListRow[];
};

export type GroupedListProps = {
  sections: readonly GroupedListSection[];
};
