/**
 * プラットフォーム差異を吸収するダイアログ API の共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - dialog.native.ts ... iOS/Android (React Native の Alert.alert)
 * - dialog.web.ts    ... Web (window.alert / window.confirm)
 *
 * 呼び出し側は常に `@/lib/dialog` から import する。
 */

/** 単一メッセージの通知ダイアログ。OK で閉じると onClose が呼ばれる。 */
export type AlertDialog = (
  title: string,
  message: string,
  onClose?: () => void,
) => void;

/**
 * 確認ダイアログ。ユーザーが承諾したら onConfirm を呼ぶ。
 * キャンセルされた場合は何もしない。
 */
export type ConfirmDialog = (
  title: string,
  message: string,
  onConfirm: () => void,
  options?: {
    /** 承諾ボタンのラベル (既定: "OK") */
    confirmLabel?: string;
    /** キャンセルボタンのラベル (既定: "キャンセル") */
    cancelLabel?: string;
    /** 破壊的操作として扱うか (ネイティブでは赤字表示) */
    destructive?: boolean;
  },
) => void;
