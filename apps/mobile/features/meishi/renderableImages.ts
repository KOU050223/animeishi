import type {
  AnimeCollageElement,
  ImageElement,
  MeishiDocument,
  MeishiRenderContext,
} from "./types";

/** 画像読み込み（成功・失敗問わず onLoadEnd 到達）を要素ごとに通知するコールバック。 */
export type OnImageLoadEnd = () => void;

/**
 * 画像要素が実際に <Image> として描画する URI。
 * 共有画像スナップショットの読み込み待ち（countRenderableImages）と
 * ElementRenderer の描画で同じ解決を使い、ズレないようにする。
 */
export function resolveImageUri(
  el: ImageElement,
  ctx: MeishiRenderContext,
): string | null {
  switch (el.source) {
    case "avatar":
      return ctx.profile.profileImageUrl ?? null;
    case "anime":
    case "upload":
    default:
      return el.uri || null;
  }
}

// コラージュに使う画像 URL を要素のリスト設定から解決する（issue #96）。
// listSource 未設定（旧ドキュメント）は「自動」= 従来どおり
// ctx.animeCollageImages（視聴履歴 → 空ならお気に入り）にフォールバックする。
export function resolveCollageImages(
  el: AnimeCollageElement,
  ctx: MeishiRenderContext,
): string[] {
  const lists = ctx.animeLists;
  const legacy = ctx.animeCollageImages ?? [];
  // animeLists を持たない古い呼び出し側では従来リストへフォールバックする。
  // animeLists がある場合は選択したリストがそのまま結果になる（空リストは
  // 空として返す。legacy へ逃がすと別ステータスの作品が混入するため）。
  if (!lists) return legacy;
  if (el.listSource === "favorites") return lists.favorites;
  const state = el.state;
  if (state && state !== "all") return lists.byState[state] ?? [];
  if (el.listSource === "watchHistory") return lists.watchHistory;
  return legacy;
}

/**
 * ドキュメント内で実際に <Image> として描画される画像の総数。
 * 共有画像スナップショット（MeishiShareSnapshot）がキャプチャ開始を
 * 判断するために使う。ImageRender / AnimeCollageRender の描画条件と
 * 一致させること（ずれると onReady が発火せずタイムアウト待ちになる）。
 */
export function countRenderableImages(
  document: MeishiDocument,
  ctx: MeishiRenderContext,
): number {
  let count = 0;
  for (const el of document.elements) {
    if (el.type === "image") {
      if (resolveImageUri(el, ctx)) count += 1;
    } else if (el.type === "animeCollage") {
      count += resolveCollageImages(el, ctx)
        .slice(0, el.cols * el.rows)
        .filter((uri) => !!uri).length;
    }
  }
  return count;
}
