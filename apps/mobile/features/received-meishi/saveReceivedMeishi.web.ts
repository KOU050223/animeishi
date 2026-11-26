import { downloadImageFile } from "@/features/tier-lists/share/image";
import type { SaveReceivedMeishi } from "./types";

/**
 * Web: 公開スナップショットの URL から元の PNG を fetch して
 * ダウンロードする（issue #675 の「Web はダウンロード」）。画面上の
 * DOM 再キャプチャではなく配信済みの画像そのものを保存する。
 * downloadImageFile は tierList/share のバレルに出ていないため ./image を
 * 直接参照する（saveQrImage.web.ts と同じ内部参照）。
 */
export const saveReceivedMeishi: SaveReceivedMeishi = async ({
  imageUrl,
  title,
}) => {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`名刺画像の取得に失敗しました（${res.status}）`);
  }
  const blob = await res.blob();
  downloadImageFile(
    new File([blob], toFileName(title), { type: blob.type || "image/png" }),
  );
};

function toFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|]/g, "_").trim();
  return `${base || "meishi"}.png`;
}
