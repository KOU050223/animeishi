import type { Haptics } from "./types";

/**
 * Android/Web 用フォールバック。触覚フィードバックは iOS のみに絞る
 * （issue #395 決定事項）ため、この実装が解決されるプラットフォームでは
 * 全操作 no-op になる。dialog と違い throw ではなく no-op が正しい振る舞い。
 */
const noop = () => {};

export const haptics: Haptics = {
  success: noop,
  warning: noop,
  selection: noop,
  impactLight: noop,
};
