/**
 * 実績の共有に関するプラットフォーム差異吸収の共通インターフェース。
 * 実装は拡張子分割（.native.ts / .web.ts）で切り替わる。
 * 呼び出し側は常に `@/lib/achievements/share` から import する
 * （lib/tierList/share と同じ構造）。
 */

/**
 * 実績獲得メッセージを OS の共有シート or クリップボードへ渡す。
 * 戻り値は完了方法:
 * - "shared"  共有シートを開いた（キャンセルも含む）
 * - "copied"  クリップボードにコピーした
 * - "blocked" 自動では渡せなかった（Web で共有・コピーが拒否された等）。
 *   呼び出し側はメッセージ本文を選択可能な形で出し、手動コピーに逃がす。
 */
export type ShareAchievementMessage = (
  message: string,
) => Promise<"shared" | "copied" | "blocked">;
