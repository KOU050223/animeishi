import { Hono } from "hono";
import { createDb } from "@/db/client";
import { serveWorkImage } from "@/lib/annict/workImage";

/**
 * 作品画像の配信（公開・認証不要）。
 * GET /images/works/:annictWorkId は読み通しプロキシで、R2 に取り込み済みなら
 * それを返し、未取り込みなら外部の画像を取りに行って R2 に保存してから返す
 * （詳細は lib/annict/workImage.ts）。
 * アプリの <Image> と共有ページ HTML の <img> の両方から参照される。
 *
 * パスは数値 ID のみ受け付けるので、同じバケットの avatars/ 等には到達できない。
 *
 * 前段に Workers の Cache API を置く。作品一覧は 1 画面で数十枚の画像を
 * 要求するため、毎回 D1（作品行の参照）と R2 を読むと応答が遅く、D1 の
 * 読み取り行数も積み上がる。キャッシュ期間は serveWorkImage が付ける
 * Cache-Control（取り込み済み 1 日 / MAL 由来は 6 時間 / 画像なし 5 分）に従う。
 * MAL 由来を短くしているのは、削除依頼から 24 時間以内に消すため（issue #241）。
 */
export const images = new Hono<{
  // MAL_CLIENT_ID は Workers Secret（画像補完の MAL API 用。issue #238）。
  Bindings: { AVATARS: R2Bucket; DB: D1Database; MAL_CLIENT_ID?: string };
}>().get("/works/:annictWorkId{[0-9]+}", async (c) => {
  const annictWorkId = Number(c.req.param("annictWorkId"));
  if (!Number.isSafeInteger(annictWorkId)) {
    return c.json({ error: "Not found" }, 404);
  }

  // クエリ文字列でキャッシュを分けられないよう、パスだけでキーを作る。
  const cacheKey = new Request(new URL(c.req.path, c.req.url).toString());
  const cache = defaultCache();
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  // キャッシュ由来の Response はヘッダが immutable なことがあり、後段の
  // CORS ミドルウェアがヘッダを足せなくなるので作り直して返す。
  if (cached) return new Response(cached.body, cached);

  const res = await serveWorkImage(
    createDb(c.env.DB),
    c.env.AVATARS,
    annictWorkId,
    { malClientId: c.env.MAL_CLIENT_ID },
  );
  if (cache && (res.status === 200 || res.status === 404)) {
    const put = cache.put(cacheKey, res.clone()).catch(() => {});
    // テスト等で executionCtx が無い環境では投げるので、その場合は待つ。
    try {
      c.executionCtx.waitUntil(put);
    } catch {
      await put;
    }
  }
  return res;
});

// Workers では caches.default が既定キャッシュ。ブラウザの DOM CacheStorage には
// default が無く、本ファイルは mobile 側の型検査（AppType 経由）でも検査対象に
// なるため、構造的に取り出す（seasonWorksCache.ts と同じ理由）。
function defaultCache(): Cache | null {
  try {
    const storage = caches as CacheStorage & { default?: Cache };
    return storage.default ?? null;
  } catch {
    return null;
  }
}
