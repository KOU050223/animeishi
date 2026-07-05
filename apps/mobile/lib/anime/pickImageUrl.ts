// 作品の表示用画像 URL を決める共通ロジック。issue #86 で MAL ID 経由の
// AniList / Jikan 補完（resolvedImageUrl）が入ったため、Annict の imageUrl を
// そのまま使うだけでは足りない画面が増えた。分岐が散らばると 3 か所で挙動が
// ズレるので、ここに集約する。
//
// なぜサーバ側で imageUrl を差し替えないのか:
//   * 「Annict 画像を優先し、無ければ resolved に落とす」判定はクライアントの
//     表示ポリシーであってストレージの話ではない。サーバは事実（imageUrl と
//     resolvedImageUrl）をそのまま返し、どちらを見せるかはクライアントで決める。
//   * 将来「設定で SNS placeholder も許容する」等の切り替えがしたくなったとき、
//     ロジックがサーバに埋まっているとクライアント設定で覆せなくなる。

// Annict の SNS 系画像 URL は「表示できるが実質プレースホルダー」なので、
// resolvedImageUrl があるならそちらを優先したい。
// サーバ側 (services/api/src/lib/annict/imageFallback.ts) の同名関数と
// 同じロジックを保つ必要がある。片方だけ変えると挙動がズレるので、変更時は
// 両方触ること。
const PLACEHOLDER_HOST_PATTERNS = [
  /pbs\.twimg\.com/i,
  /twimg\.com/i,
  /graph\.facebook\.com/i,
  /fbcdn\.net/i,
];

export function isPlaceholderImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_HOST_PATTERNS.some((re) => re.test(trimmed));
}

export type PickImageUrlInput = {
  imageUrl?: string | null;
  resolvedImageUrl?: string | null;
};

/**
 * 作品カード・コラージュ等で表示する 1 枚の URL を返す。優先順:
 *   1. Annict の imageUrl が非 placeholder ならそれ
 *   2. resolvedImageUrl（AniList / Jikan 由来）
 *   3. Annict の imageUrl が placeholder でも「無いよりマシ」で返す
 *   4. どちらも無ければ null（呼び出し側でプレースホルダー描画）
 */
export function pickImageUrl(item: PickImageUrlInput): string | null {
  const { imageUrl, resolvedImageUrl } = item;
  if (imageUrl && !isPlaceholderImageUrl(imageUrl)) return imageUrl;
  if (resolvedImageUrl) return resolvedImageUrl;
  if (imageUrl) return imageUrl;
  return null;
}
