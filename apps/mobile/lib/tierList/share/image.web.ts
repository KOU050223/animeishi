import { toPng } from "html-to-image";
import { apiUrl } from "@/lib/apiUrl";
import type { CaptureTierListImageFile, ShareTierListImage } from "./types";

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

/**
 * API 自身が配信する取り込み済み作品画像（/images/...）か。
 * これらは CORS 付きで配信されるためプロキシ不要。それどころか image-proxy の
 * known-URL 照合（image_url / resolved_image_url カラム照合）を通らず
 * 403 になるので、ここで弾いてそのまま使う（issue #174）。
 */
function isApiHostedImageUrl(src: string): boolean {
  try {
    return (
      new URL(src).origin === new URL(apiUrl).origin &&
      new URL(src).pathname.startsWith("/images/")
    );
  } catch {
    return false;
  }
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
 * 画面外にレンダリングしたスナップショットの DOM を html-to-image で PNG 化し、
 * File として返す。共有・ダウンロードへの受け渡しは行わない
 * （Web Share API のユーザー操作期限があるため、受け渡しは
 * クリックハンドラ内で shareImageFile / downloadImageFile を呼ぶ）。
 *
 * 事前に <img> の src を API の画像プロキシへ差し替える。差し替えた img の
 * 読み込みに失敗したものは取り除く（タイトルだけのカードが残る）。
 * 元の src への復元はしない（スナップショットはキャプチャ後に破棄される）。
 */
export const captureTierListImageFile: CaptureTierListImageFile = async (
  target,
  { title },
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
      // API 配信の取り込み済み画像は CORS 付きなのでそのまま使える
      if (isApiHostedImageUrl(src)) return;
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

  return new File([dataUrlToBlob(dataUrl)], toFileName(title), {
    type: "image/png",
  });
};

/** navigator.share({ files }) で画像ファイルを渡せる環境か。 */
export function canShareImageFile(file: File): boolean {
  const nav = navigator as WebNavigator;
  return (
    typeof nav.canShare === "function" &&
    typeof nav.share === "function" &&
    nav.canShare({ files: [file] })
  );
}

/**
 * 共有シートで画像ファイルを渡す。ユーザーがシートを閉じた（AbortError）は
 * 完了扱いでそのまま返る。それ以外の失敗は throw する。
 * ユーザー操作期限があるためクリックハンドラ内で直接呼ぶこと
 * （生成処理の後に呼ぶと期限切れで NotAllowedError になる）。
 */
export async function shareImageFile(file: File, title: string): Promise<void> {
  const nav = navigator as WebNavigator;
  if (typeof nav.share !== "function") {
    throw new Error("Web Share API を利用できません");
  }
  try {
    await nav.share({ files: [file], title });
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return;
    throw e;
  }
}

/** 画像ファイルをダウンロードとして保存する。 */
export function downloadImageFile(file: File): void {
  downloadBlob(file, file.name);
}

/**
 * Web: キャプチャ → 共有シート / ダウンロードまで一気に行う簡易経路。
 * 共有モーダル経由（captureTierListImageFile + shareImageFile 等）が
 * 通常の UI で、こちらは ShareTierListImage インターフェースの互換実装。
 */
export const shareTierListImage: ShareTierListImage = async (
  target,
  { dialogTitle },
) => {
  const file = await captureTierListImageFile(target, { title: dialogTitle });
  if (canShareImageFile(file)) {
    try {
      await shareImageFile(file, dialogTitle);
      return;
    } catch {
      // 共有に失敗した場合はダウンロードへフォールバック
    }
  }
  downloadImageFile(file);
};
