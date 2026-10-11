import { toPng } from "html-to-image";
import { apiUrl } from "@/lib/apiUrl";
import type { ShareTierListImage } from "./types";

// RN 向け tsconfig の DOM lib では Navigator.share / canShare が
// 型に無いことがあるため、自前で補う。
type WebNavigator = Navigator & {
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
};

/** プロキシ経由に差し替えた画像の読み込みを待つ上限。 */
const IMAGE_LOAD_TIMEOUT_MS = 5000;

/**
 * 作品画像を API の画像プロキシ経由で取得し直す URL。
 * 外部 CDN（Annict / AniList / MAL 等）は CORS ヘッダを返さないため、
 * html-to-image が画像をインライン化できず空欄になる。
 */
function buildImageProxyUrl(imageUrl: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/share/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}

/** load で true、error / タイムアウトで false を解決する。 */
function waitForImage(img: HTMLImageElement): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      resolve(ok);
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), IMAGE_LOAD_TIMEOUT_MS);
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, body] = dataUrl.split(",");
  const mime = /^data:(.*?)(?:;|$)/.exec(header ?? "")?.[1] || "image/png";
  const binary = atob(body ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function toFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|]/g, "_").trim();
  return `${base || "tier-list"}.png`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // click は同期的にダウンロードを開始する。即 revoke でも問題ないブラウザが
  // 多いが、実装差を吸収するため次タスクで解放する。
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Web: 画面外にレンダリングしたスナップショットの DOM を html-to-image で
 * PNG 化し、Web Share API（files）が使えれば共有シートへ、無ければ
 * ダウンロードとして保存する。
 *
 * 事前に <img> の src を API の画像プロキシへ差し替える。差し替えた img の
 * 読み込みに失敗したものは取り除く（タイトルだけのカードが残る）。
 * 元の src への復元はしない（スナップショットはキャプチャ後に破棄される）。
 */
export const shareTierListImage: ShareTierListImage = async (
  target,
  { dialogTitle },
) => {
  const node = target.current as unknown;
  if (!(node instanceof HTMLElement)) {
    throw new Error("キャプチャ対象の DOM 要素が見つかりません");
  }

  // プロキシ差し替えはイベント購読より先に全て同期で行う
  // （1 枚ずつ await すると直列になって遅い）。
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      // data:/blob: や既にプロキシ済みの URL はそのまま使える
      if (!/^https?:\/\//i.test(src)) return;
      img.src = buildImageProxyUrl(src);
      if (!(await waitForImage(img))) img.remove();
    }),
  );

  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: "#111827",
    // システムフォントだけを使うため @font-face の収集は不要。
    // 外部フォント CSS の fetch 失敗でキャプチャ全体が遅れるのを防ぐ。
    skipFonts: true,
  });

  const blob = dataUrlToBlob(dataUrl);
  const fileName = toFileName(dialogTitle);
  const file = new File([blob], fileName, { type: "image/png" });
  const nav = navigator as WebNavigator;

  if (
    typeof nav.canShare === "function" &&
    typeof nav.share === "function" &&
    nav.canShare({ files: [file] })
  ) {
    try {
      await nav.share({ files: [file], title: dialogTitle });
      return;
    } catch (e) {
      // ユーザーがシートを閉じただけ（AbortError）は完了扱い
      if ((e as DOMException).name === "AbortError") return;
      // 共有に失敗した場合はダウンロードへフォールバック
    }
  }

  downloadBlob(blob, fileName);
};
