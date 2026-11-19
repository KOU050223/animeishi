import { useEffect, useRef } from "react";

/**
 * ネイティブのシートが閉じ切ったとみなすまでの見込み時間（ミリ秒）。
 * 退場アニメーションの完了を正確に検知する術が無いため、既定の
 * トランジション時間よりやや長めに取っている。
 */
const DISMISS_FALLBACK_MS = 500;

/**
 * `visible` が true → false に変わったタイミングから見込み時間後に
 * `onClosed` を呼ぶ。iOS（BottomSheet.ios.tsx）・Android
 * （BottomSheet.native.tsx）で共用する。
 *
 * この仕組みが必要な理由:
 * - Android の ModalBottomSheet.onDismissRequest はスワイプ・スクリム・
 *   戻る操作などユーザー起因の退場にしか呼ばれず、isPresented=false に
 *   よるプログラム的なクローズは通知されない（expo-ui が内部で
 *   sheetState.hide() を呼ぶだけ）。
 * - iOS は props.onDismiss（SwiftUI .sheet の onDismiss＝退場完了）が
 *   JS 側に転送されておらず、代わりに届く onIsPresentedChange は
 *   @State の値変化＝退場アニメーションの開始時点で呼ばれる。
 *
 * 退場が終わる前に次のモーダルを出すと、iOS では表示処理が競合して
 * 開かれなくなることがあるため、完了見込み時間まで遅らせる。
 */
export function useDeferredOnClosed(
  visible: boolean,
  onClosed: (() => void) | undefined,
) {
  const onClosedRef = useRef(onClosed);
  const wasVisible = useRef(visible);

  useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  useEffect(() => {
    if (!wasVisible.current || visible) {
      wasVisible.current = visible;
      return;
    }
    wasVisible.current = false;
    const timer = setTimeout(
      () => onClosedRef.current?.(),
      DISMISS_FALLBACK_MS,
    );
    return () => clearTimeout(timer);
  }, [visible]);
}
