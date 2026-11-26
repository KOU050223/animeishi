// Web: ブラウザの逆ジオコーディングは expo-location が提供しないため、
// 地名の自動取得は持たない。呼び出し側は手入力フォールバックを出す
// （座標を自前で持ち出さないのは issue #661 の「座標は端末で破棄」方針）。
import type { ResolvePlaceName } from "./types";

export const resolvePlaceName: ResolvePlaceName = async () => ({
  kind: "unavailable",
});
