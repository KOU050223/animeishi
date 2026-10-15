import { Hono } from "hono";
import { workImageKeyFromUrl } from "@/lib/annict/imagePrefetch";

/**
 * 作品画像の配信（公開・認証不要）。
 * cron が R2 に事前取り込みした画像（issue #174）を GET /images/works/... で返す。
 * アバター配信（GET /me/profile/avatar/*）と同じく immutable キャッシュ前提。
 * アプリの <Image> と共有ページ HTML の <img> の両方から参照される。
 *
 * キーは `works/<annictWorkId>/<sourceUrlHash>.<ext>` 形式のみ許可する
 * （workImageKeyFromUrl が検証）ため、avatars/ 等の他用途オブジェクトには
 * 到達できない。
 */
export const images = new Hono<{ Bindings: { AVATARS: R2Bucket } }>().get(
  "/works/*",
  async (c) => {
    const key = workImageKeyFromUrl(c.req.url);
    if (!key) return c.json({ error: "Not found" }, 404);

    const object = await c.env.AVATARS.get(key);
    if (!object) return c.json({ error: "Not found" }, 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    // Content-Type は取り込み時に画像系のみ許可しているが、配信経路でも
    // ブラウザの MIME スニッフィングを抑止しておく。
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  },
);
