import { scanFromURLAsync } from "expo-camera";

import type { ScanQrFromImage } from "./types";

/** 名刺 QR の画像ファイル（ローカル URI）から QR の内容を読み取る。 */
export const scanQrFromImage: ScanQrFromImage = async (uri) => {
  const results = await scanFromURLAsync(uri, ["qr"]);
  return results.map((result) => result.data);
};
