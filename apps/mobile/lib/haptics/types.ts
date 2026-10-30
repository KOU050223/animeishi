/**
 * プラットフォーム差異を吸収するハプティクス API の共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - haptics.ios.ts ... iOS (expo-haptics)
 * - haptics.ts     ... Android/Web (no-op。触覚フィードバックは iOS のみに絞る)
 *
 * 呼び出し側は常に `@/lib/haptics` から import する。
 */
export type Haptics = {
  /** 保存などの成功操作が完了したときの通知フィードバック。 */
  success: () => void;
  /** 削除など注意を要する操作の通知フィードバック。 */
  warning: () => void;
  /** セグメント・ピッカーの値切替。 */
  selection: () => void;
  /** ドラッグ&ドロップの吸着など、軽い物理フィードバック。 */
  impactLight: () => void;
};
