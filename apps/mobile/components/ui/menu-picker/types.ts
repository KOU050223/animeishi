/**
 * プラットフォーム差異を吸収するメニュー型ピッカーの共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - MenuPicker.native.tsx ... iOS/Android（@expo/ui の Picker = 純正メニュー）
 * - MenuPicker.web.tsx    ... Web（既存と同じ Modal + 一覧構成）
 *
 * 呼び出し側は常に `@/components/ui/menu-picker` から import する。
 * 表示文言は基盤側に既定値を持たせず、必ず呼び出し側が渡す。
 */
export type MenuPickerOption<T extends string | number> = {
  /** 選択肢に表示する文言。 */
  label: string;
  value: T;
  /** 選択肢のアクセシビリティラベル（Web 実装で使う）。 */
  accessibilityLabel?: string;
};

export type MenuPickerProps<T extends string | number> = {
  /**
   * ベースの testID。以下の要素 ID に展開される:
   * - `{base}-button`         ... ピッカーを開くボタン
   * - `{base}-option-{value}` ... 各選択肢（Web / テスト用モック）
   */
  testID?: string;
  /** ピッカーを開くボタンのアクセシビリティラベル。 */
  accessibilityLabel: string;
  /** 選択 UI のタイトル（Web のシート見出しに使う）。 */
  title: string;
  /** 選択 UI を閉じる操作のアクセシビリティラベル（Web のスクリム）。 */
  closeAccessibilityLabel: string;
  selectedValue: T;
  options: readonly MenuPickerOption<T>[];
  /** 選択肢が選ばれたとき。選択 UI は選択後に自動で閉じる。 */
  onValueChange: (value: T) => void;
};
