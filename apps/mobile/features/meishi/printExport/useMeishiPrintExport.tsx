import type { UseMeishiPrintExport } from "./types";

// プラットフォーム解決のフォールバック。web / native で解決されるため
// ここには来ないが、型定義（tsc はこのファイルを参照する）を兼ねる。
export const useMeishiPrintExport: UseMeishiPrintExport = () => {
  throw new Error("このプラットフォームでは未実装です");
};
