// フォールバック兼・型定義（実装は .native / .web が解決される）。
import type { ResolvePlaceName } from "./types";

export const resolvePlaceName: ResolvePlaceName = () => {
  throw new Error(
    "resolvePlaceName がこのプラットフォームで解決されませんでした",
  );
};
