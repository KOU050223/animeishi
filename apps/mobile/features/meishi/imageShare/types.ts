import type { ReactNode } from "react";
import type { MeishiDocument, MeishiRenderContext } from "../types";

export type UseMeishiImageShare = (input: {
  /** 名刺ドキュメント。未作成（null）なら classic テンプレで撮る。 */
  document: MeishiDocument | null | undefined;
  context: MeishiRenderContext;
}) => {
  /** 名刺を画像化して OS の共有シート（web は共有 / ダウンロード）へ渡す。 */
  shareImage: () => Promise<void>;
  isSharing: boolean;
  /** 画面外スナップショットの描画要素。画面の JSX に必ず描画すること。 */
  snapshotElement: ReactNode;
};
