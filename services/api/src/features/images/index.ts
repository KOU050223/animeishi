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
 */
export const images = new Hono<{
  Bindings: { AVATARS: R2Bucket; DB: D1Database };
}>().get("/works/:annictWorkId{[0-9]+}", async (c) => {
  const annictWorkId = Number(c.req.param("annictWorkId"));
  if (!Number.isSafeInteger(annictWorkId)) {
    return c.json({ error: "Not found" }, 404);
  }
  return serveWorkImage(createDb(c.env.DB), c.env.AVATARS, annictWorkId);
});
