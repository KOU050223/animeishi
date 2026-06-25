/**
 * プラットフォーム差異を吸収するダイアログ API の共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - dialog.native.ts ... iOS/Android (React Native の Alert.alert)
 * - dialog.web.ts    ... Web (window.alert / window.confirm)
 *
 * 呼び出し側は常に `@/lib/dialog` から import する。
 */

/**
 * 単一メッセージの通知ダイアログ。閉じると onClose が呼ばれる。
 *
 * ConfirmDialog と同様、ボタン文言は基盤に既定値を持たせず
 * 必ず呼び出し側が渡す（i18n の責務を呼び出し側に置くため）。
 */
export type AlertDialog = (
  title: string,
  message: string,
  options: {
    /** 閉じるボタンのラベル */
    okLabel: string;
    /** 閉じたときに呼ばれるコールバック */
    onClose?: () => void;
  },
) => void;

/**
 * 確認ダイアログ。ユーザーが承諾したら onConfirm を呼ぶ。
 * キャンセルされた場合は何もしない。
 *
 * ラベルはこの基盤では既定値を持たず、必ず呼び出し側が渡す。
 * 表示言語の決定（i18n の t() 等）は呼び出し側の責務とし、
 * 低レベルな抽象化基盤を i18n インスタンスに依存させないため。
 */
export type ConfirmDialog = (
  title: string,
  message: string,
  onConfirm: () => void,
  options: {
    /** 承諾ボタンのラベル */
    confirmLabel: string;
    /** キャンセルボタンのラベル */
    cancelLabel: string;
    /** 破壊的操作として扱うか (ネイティブでは赤字表示) */
    destructive?: boolean;
  },
) => void;
