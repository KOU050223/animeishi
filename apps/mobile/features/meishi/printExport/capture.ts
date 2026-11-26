import type { MutableRefObject, RefObject } from "react";
import type { ViewInstance } from "react-native";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";

/**
 * 画像キャプチャ前にスナップショットの画像読み込みを待つ上限。
 * これを超えても未読み込みなら欠けたまま撮る（書き出し自体を失敗させない）。
 */
const SNAPSHOT_WAIT_MAX_MS = 5000;

export type MeishiPrintExportFlowInput = {
  frontRef: RefObject<ViewInstance | null>;
  backRef: RefObject<ViewInstance | null>;
  /** 共有実行の瞬間だけスナップショットを画面外にマウントする。 */
  mountSnapshot: () => void;
  snapshotReadyRef: MutableRefObject<(() => void) | null>;
  /** 表・裏のキャプチャと、共有シート / ダウンロードへの受け渡し。 */
  deliver: (
    frontRef: RefObject<ViewInstance | null>,
    backRef: RefObject<ViewInstance | null>,
  ) => Promise<void>;
  failureTitle: string;
  failureMessage: string;
};

/**
 * 印刷用書き出し（issue #665）の実行部。スナップショットのマウントと
 * 画像読み込み待ちは共通にし、撮った PNG の受け渡しだけをプラットフォーム
 * 実装へ委ねる。フック本体から切り離したプレーンな async 関数に置くのは、
 * React Compiler がコンパイル対象外のコードだけを解釈できる構文
 * （try/finally・try 内の throw）にするため（imageShare/capture.ts と同じ）。
 * 失敗時は共通のアラートを出して解決する（throw は外に出さない）。
 */
export async function runMeishiPrintExport(
  input: MeishiPrintExportFlowInput,
): Promise<void> {
  trackEvent("meishi_print_export");
  try {
    const snapshotReady = new Promise<void>((resolve) => {
      input.snapshotReadyRef.current = resolve;
    });
    input.mountSnapshot();
    // スナップショットの描画と画像の読み込み（onReady）を待ってから撮る。
    // タイムアウトを超えたら読み込み途中のまま撮る（書き出し自体は失敗させない）。
    await Promise.race([
      snapshotReady,
      new Promise((resolve) => setTimeout(resolve, SNAPSHOT_WAIT_MAX_MS)),
    ]);
    // レイアウト確定のため 1 フレーム待つ
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!input.frontRef.current || !input.backRef.current) {
      throw new Error("スナップショットの描画に失敗しました");
    }
    await input.deliver(input.frontRef, input.backRef);
  } catch {
    alert(input.failureTitle, input.failureMessage, { okLabel: "OK" });
  }
}
