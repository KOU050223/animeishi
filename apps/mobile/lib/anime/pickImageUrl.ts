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
// resolvedImageUrl があるならそちらを優先したい。また HTTPS で配信される Web 版では
// http: 画像が Mixed Content になるため、補完画像へ落とす。
// サーバ側 (services/api/src/lib/annict/imageFallback.ts) の同名関数と
// 同じロジックを保つ必要がある。片方だけ変えると挙動がズレるので、変更時は
// 両方触ること。
const PLACEHOLDER_HOST_PATTERNS = [
  /pbs\.twimg\.com/i,
  /twimg\.com/i,
  /graph\.facebook\.com/i,
  /fbcdn\.net/i,
];

function isInsecureHttpUrl(url: string): boolean {
  return /^http:/i.test(url.trim());
}

export function isPlaceholderImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (isInsecureHttpUrl(trimmed)) return true;
  return PLACEHOLDER_HOST_PATTERNS.some((re) => re.test(trimmed));
}

export type PickImageUrlInput = {
  // API の作品画像プロキシ URL（GET /images/works/:id）。外部候補の取得・
  // 検証・R2 保存はプロキシ側が行うので、通常はこれだけで表示できる。
  hostedImageUrl?: string | null;
  imageUrl?: string | null;
  resolvedImageUrl?: string | null;
};

/**
 * 表示用画像 URL の候補を優先順で返す。先頭から順に:
 *   1. hostedImageUrl（API の画像プロキシ。外部 CDN の初回遅延・ホットリンク
 *      制限・実体 404 をサーバ側で吸収するので最優先）
 *   2. Annict の imageUrl が非 placeholder ならそれ
 *   3. resolvedImageUrl（AniList / Jikan 由来）
 *   4. Annict の imageUrl が placeholder でも「無いよりマシ」で返す
 * 先頭の読み込みに失敗したとき次候補へ切り替える用途に使う
 * （プロキシが 404 / API 到達不能でも外部 URL があれば拾い直す保険）。
 * 同じ URL が複数経路から来ても無駄な再試行をしないよう重複は除く。
 */
export function pickImageUrlCandidates(item: PickImageUrlInput): string[] {
  const { hostedImageUrl, imageUrl, resolvedImageUrl } = item;
  const candidates: string[] = [];
  if (hostedImageUrl) candidates.push(hostedImageUrl);
  if (imageUrl && !isPlaceholderImageUrl(imageUrl)) candidates.push(imageUrl);
  if (resolvedImageUrl) candidates.push(resolvedImageUrl);
  if (imageUrl && !isInsecureHttpUrl(imageUrl)) candidates.push(imageUrl);
  return [...new Set(candidates)];
}

/**
 * 作品カード・コラージュ等で表示する 1 枚の URL を返す。
 * pickImageUrlCandidates の先頭。どれも無ければ null
 * （呼び出し側でプレースホルダー描画）。
 */
export function pickImageUrl(item: PickImageUrlInput): string | null {
  return pickImageUrlCandidates(item)[0] ?? null;
}
