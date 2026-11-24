import type { RefObject } from "react";
import type { ViewInstance } from "react-native";
import type { SnapshotItem } from "@/components/tier-list/TierBoardSnapshot";

// スナップショットの描画と画像読み込み（onReady）を待つ上限。
// 超えたら読み込み途中のまま撮る（共有自体は失敗させない）。
const SNAPSHOT_WAIT_MAX_MS = 5000;

/**
 * 共有 URL 発行フロー（保存 → トークン発行 → URL をユーザーへ届ける）。
 * try/finally を含むため React Compiler が最適化できず、画面側に置くと
 * コンポーネント全体の自動メモ化が効かなくなる。モジュール関数として
 * 切り出す（lib/useSignOut.ts と同じ形。issue #730）。
 */
export async function shareTierListViaUrl({
  beginShare,
  cancelShare,
  setIsSharing,
  createShareUrl,
  presentShareUrl,
  onFailure,
}: {
  beginShare: () => void;
  cancelShare: () => void;
  setIsSharing: (sharing: boolean) => void;
  /** 盤面保存とトークン発行を行い共有 URL を返す。 */
  createShareUrl: () => Promise<string>;
  presentShareUrl: (url: string) => Promise<unknown>;
  /** 失敗時の通知（ダイアログ表示など）。 */
  onFailure: () => void;
}): Promise<void> {
  beginShare();
  setIsSharing(true);
  try {
    const url = await createShareUrl();
    // native は OS 共有シート。web は urlShareElement のモーダルを開き、
    // コピー / X 共有はモーダル内のボタン操作で行う。
    await presentShareUrl(url);
  } catch {
    cancelShare();
    onFailure();
  } finally {
    setIsSharing(false);
  }
}

/**
 * 盤面を保存し、保存結果をスナップショットに描画させてから run を実行する
 * 共通処理。画像には共有 URL が要らないためトークン発行はしない。
 * try/finally を含むためモジュール関数に切り出している（理由は上記と同じ）。
 */
export async function withRenderedTierSnapshot<TItem, T>({
  saveBoard,
  mapItem,
  snapshotReadyRef,
  snapshotRef,
  setSnapshotItems,
  setIsSharing,
  renderFailedMessage,
  run,
}: {
  /** 保存済み盤面を返す（save.mutateAsync 相当）。 */
  saveBoard: () => Promise<{ items: TItem[] }>;
  /** 保存済み items をスナップショット描画用の形に写す。 */
  mapItem: (item: TItem) => SnapshotItem;
  snapshotReadyRef: RefObject<(() => void) | null>;
  snapshotRef: RefObject<ViewInstance | null>;
  setSnapshotItems: (items: SnapshotItem[] | null) => void;
  setIsSharing: (sharing: boolean) => void;
  /** スナップショット未描画のまま撮ろうとしたときのエラーメッセージ。 */
  renderFailedMessage: string;
  run: () => Promise<T>;
}): Promise<T> {
  setIsSharing(true);
  try {
    const savedData = await saveBoard();
    const snapshotReady = new Promise<void>((resolve) => {
      snapshotReadyRef.current = resolve;
    });
    setSnapshotItems(savedData.items.map(mapItem));
    // スナップショットの描画と画像の読み込み（onReady）を待ってから撮る。
    // タイムアウトを超えたら読み込み途中のまま撮る。
    await Promise.race([
      snapshotReady,
      new Promise((resolve) => setTimeout(resolve, SNAPSHOT_WAIT_MAX_MS)),
    ]);
    // レイアウト確定のため 1 フレーム待つ
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!snapshotRef.current) {
      throw new Error(renderFailedMessage);
    }
    return await run();
  } finally {
    setSnapshotItems(null);
    setIsSharing(false);
  }
}
