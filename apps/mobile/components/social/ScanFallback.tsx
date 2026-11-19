import type { ReactElement } from "react";

export type ScanFallbackReason =
  /** カメラ権限が拒否されている。 */
  | "denied"
  /** 権限はあるがカメラの起動・映像取得に失敗した。 */
  | "error";

export type ScanFallbackProps = {
  reason: ScanFallbackReason;
  /**
   * 権限の再要求・カメラの再マウントを行うハンドラ。
   * 省略時は再試行ボタンを出さない。
   */
  onRetry?: () => void;
};

export function ScanFallback(_props: ScanFallbackProps): ReactElement {
  throw new Error("ScanFallback: プラットフォーム実装が解決されていません");
}
