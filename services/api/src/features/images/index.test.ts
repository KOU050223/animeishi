import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { setupTestDb } from "../../test-utils/setup-db";
import { annictWorks } from "../../db/schema";
import { images } from "./index";

// /images/* は公開ルート（認証不要）。作品画像の読み通しプロキシを担う。
// 取り込みの詳細なふるまいは lib/annict/workImage.test.ts で検証する。

const TEST_BINDINGS = {
  AVATARS: env.AVATARS,
  DB: env.DB,
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function buildApp() {
  const app = applyApiErrorHandling(
    new Hono<{ Bindings: { AVATARS: R2Bucket; DB: D1Database } }>(),
  );
  app.route("/images", images);
  return app;
}

describe("GET /images/works/:annictWorkId（作品画像プロキシ）", () => {
  beforeEach(async () => {
    const db = await setupTestDb(env.DB);
    await db.insert(annictWorks).values({
      annictWorkId: 42,
      title: "作品",
      imageR2Key: "works/42/deadbeef.png",
      updatedAt: new Date(),
    });
    const listed = await env.AVATARS.list();
    if (listed.objects.length > 0) {
      await env.AVATARS.delete(listed.objects.map((o) => o.key));
    }
  });

  it("取り込み済みの画像を配信する", async () => {
    await env.AVATARS.put("works/42/deadbeef.png", PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
    });
    const res = await buildApp().request(
      "/images/works/42",
      { method: "GET" },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("存在しない作品は 404", async () => {
    const res = await buildApp().request(
      "/images/works/999",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("数値 ID 以外・R2 キー直指定のパスは 404（avatars/ 等に到達できない）", async () => {
    await env.AVATARS.put("avatars/u1/icon.webp", PNG_BYTES, {
      httpMetadata: { contentType: "image/webp" },
    });
    for (const path of [
      "/images/works/abc",
      "/images/works/42/deadbeef.png",
      "/images/works/42/../../avatars/u1/icon.webp",
      "/images/avatars/u1/icon.webp",
    ]) {
      const res = await buildApp().request(
        path,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    }
  });
});
