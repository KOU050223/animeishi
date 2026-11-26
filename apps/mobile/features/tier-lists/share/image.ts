import type { CaptureTierListImageFile, ShareTierListImage } from "./types";

export const shareTierListImage: ShareTierListImage = () => {
  throw new Error("share/image: プラットフォーム実装が解決されていません");
};

export const captureTierListImageFile: CaptureTierListImageFile = () => {
  throw new Error("share/image: プラットフォーム実装が解決されていません");
};

// Web 共有モーダル専用の受け渡しヘルパー。./image を参照する
// urlShare.web.tsx の型解決用にフォールバックにも定義しておく。
export function canShareImageFile(_file: File): boolean {
  throw new Error("share/image: プラットフォーム実装が解決されていません");
}

export function shareImageFile(_file: File, _title: string): Promise<void> {
  throw new Error("share/image: プラットフォーム実装が解決されていません");
}

export function downloadImageFile(_file: File): void {
  throw new Error("share/image: プラットフォーム実装が解決されていません");
}
