import {
  captureTierListImageFile,
  downloadImageFile,
} from "@/lib/tierList/share/image";
import type { SaveQrImage } from "./types";

/**
 * Web: 画面上の QR カード DOM を html-to-image で PNG 化してダウンロードする
 * （issue #413 の「Web はダウンロード」）。
 * downloadImageFile は tierList/share のバレルに出ていないため ./image を
 * 直接参照する（urlShare.web.tsx と同じ内部参照）。
 */
export const saveQrImage: SaveQrImage = async (
  target,
  { title, backgroundColor },
) => {
  const file = await captureTierListImageFile(target, {
    title,
    backgroundColor,
  });
  downloadImageFile(file);
};
