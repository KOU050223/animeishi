import type { ReactNode } from "react";
import type { MeishiDocument, MeishiRenderContext } from "../types";

export type UseMeishiPrintExport = (input: {
  /** 名刺ドキュメント。未作成（null）なら classic テンプレで撮る。 */
  document: MeishiDocument | null | undefined;
  context: MeishiRenderContext;
}) => {
  /**
   * 表・裏の印刷用 PNG（97×61mm・300dpi 相当）を書き出す。
   * native は OS の共有シートへ、web はダウンロードへ渡す。
   */
  exportPrintImages: () => Promise<void>;
  isExporting: boolean;
  /** 画面外スナップショットの描画要素。画面の JSX に必ず描画すること。 */
  snapshotElement: ReactNode;
};
