import type { ReactNode } from "react";

/**
 * プラットフォーム差異を吸収するボトムシートの共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - BottomSheet.native.tsx ... iOS/Android（@expo/ui の BottomSheet = 純正シート）
 * - BottomSheet.web.tsx    ... Web（既存と同じ Modal + スクリム構成）
 *
 * 呼び出し側は常に `@/components/ui/bottom-sheet` から import する。
 */
export type BottomSheetProps = {
  /** シートを表示するか。 */
  visible: boolean;
  /** スワイプ・スクリム・バックキーなどで閉じられたときに呼ばれる。 */
  onClose: () => void;
  /**
   * シート内に描く内容。どちらの実装でも React Native のビューとして
   * 描画されるため、タイトル・選択肢・ボタン等は呼び出し側が RN で組み立てる。
   * 背景・角丸・ドラッグハンドル等のシートの外観は基盤側が持つ。
   */
  children: ReactNode;
  /**
   * シートを閉じるスクリム（背面タップ）のアクセシビリティラベル。
   * ネイティブシートではスクリムは OS が管理するため Web 実装だけが使う。
   */
  scrimAccessibilityLabel?: string;
  testID?: string;
};
