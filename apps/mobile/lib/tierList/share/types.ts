import type { RefObject } from "react";
import type { View } from "react-native";

/**
 * tier 表の共有に関するプラットフォーム差異吸収の共通インターフェース。
 * 実装は拡張子分割（.native.ts / .web.ts）で切り替わる。
 * 呼び出し側は常に `@/lib/tierList/share` から import する。
 */

/**
 * 共有方法の選択肢を提示する。
 * ボタン文言は基盤側に既定値を持たせず、必ず呼び出し側が渡す。
 */
export type PresentTierShareOptions = (input: {
  dialogTitle: string;
  urlLabel: string;
  imageLabel: string;
  cancelLabel: string;
  onShareUrl: () => void;
  onShareImage: () => void;
}) => void;

/**
 * 共有 URL を OS の共有シート or クリップボードへ渡す。
 * 戻り値は完了方法（"shared" は共有シート、"copied" はクリップボード）。
 * Web で Web Share API が使えない環境へのフォールバック表示に使う。
 */
export type ShareTierListUrl = (url: string) => Promise<"shared" | "copied">;

/**
 * キャプチャ対象の View を PNG 化して共有シートへ渡す。
 * Web は非対応（options.web が画像選択肢を出さないため呼ばれない）。
 */
export type ShareTierListImage = (
  target: RefObject<View | null>,
  options: { dialogTitle: string },
) => Promise<void>;
