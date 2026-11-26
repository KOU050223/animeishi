import type { MutableRefObject, RefObject } from "react";
import type { ViewInstance } from "react-native";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { shareTierListImage } from "@/lib/tierList/share";

/**
 * 画像キャプチャ前にスナップショットの画像読み込みを待つ上限（native のみ）。
 * これを超えても未読み込みなら欠けたまま撮る（共有自体を失敗させない）。
 */
const SNAPSHOT_WAIT_MAX_MS = 5000;

export type MeishiImageShareFlowInput = {
  snapshotRef: RefObject<ViewInstance | null>;
  /**
   * native: 共有実行の瞬間だけスナップショットを画面外にマウントするための
   * 準備。web は常時マウント済みなので渡さない（押下から撮影まで待つと
   * Web Share API のユーザー操作期限が切れてダウンロードへフォールバック
   * してしまうため、web では準備ステップ自体を走らせない）。
   */
  prepare?: {
    mountSnapshot: () => void;
    snapshotReadyRef: MutableRefObject<(() => void) | null>;
  };
  dialogTitle: string;
  backgroundColor: string;
  failureTitle: string;
  failureMessage: string;
};

/**
 * 名刺の画像化→共有の実行部（issue #425）。フック本体から切り離した
 * プレーンな async 関数に置くのは、React Compiler がコンパイル対象外の
 * コードだけを解釈できる構文（try/finally・try 内の throw）にするため。
 * 失敗時は共通のアラートを出して解決する（throw は外に出さない）。
 */
export async function runMeishiImageShare(
  input: MeishiImageShareFlowInput,
): Promise<void> {
  trackEvent("meishi_share");
  try {
    if (input.prepare) {
      const { mountSnapshot, snapshotReadyRef } = input.prepare;
      const snapshotReady = new Promise<void>((resolve) => {
        snapshotReadyRef.current = resolve;
      });
      mountSnapshot();
      // スナップショットの描画と画像の読み込み（onReady）を待ってから撮る。
      // タイムアウトを超えたら読み込み途中のまま撮る（共有自体は失敗させない）。
      await Promise.race([
        snapshotReady,
        new Promise((resolve) => setTimeout(resolve, SNAPSHOT_WAIT_MAX_MS)),
      ]);
      // レイアウト確定のため 1 フレーム待つ
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    if (!input.snapshotRef.current) {
      throw new Error("スナップショットの描画に失敗しました");
    }
    await shareTierListImage(input.snapshotRef, {
      dialogTitle: input.dialogTitle,
      backgroundColor: input.backgroundColor,
    });
  } catch {
    alert(input.failureTitle, input.failureMessage, { okLabel: "OK" });
  }
}
