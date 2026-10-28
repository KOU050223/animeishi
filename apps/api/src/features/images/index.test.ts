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
    await caches.default.delete("http://localhost/images/works/42");
    await caches.default.delete("http://localhost/images/works/999");
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

  it("2 回目はエッジキャッシュから返し、R2 を読まない", async () => {
    await env.AVATARS.put("works/42/deadbeef.png", PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
    });
    const app = buildApp();
    const first = await app.request(
      "/images/works/42",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(first.status).toBe(200);
    await first.arrayBuffer();

    // R2 から消しても、キャッシュに残っているので返せる
    await env.AVATARS.delete("works/42/deadbeef.png");
    const second = await app.request(
      "/images/works/42?bust=1",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(PNG_BYTES);
  });

  // issue #244。削除スクリプトがタグ指定の Purge Cache でこのエントリを消せる
  // ようにするため、保存する側にだけ付ける（クライアントには出さない）。
  it("キャッシュに保存したレスポンスにだけ Cache-Tag が付く", async () => {
    await env.AVATARS.put("works/42/deadbeef.png", PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
    });
    const app = buildApp();
    const res = await app.request(
      "/images/works/42",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-tag")).toBeNull();
    await res.arrayBuffer();

    // 2 回目のリクエストで cache.put 完了を確実にしてから中身を見る
    await (
      await app.request("/images/works/42", { method: "GET" }, TEST_BINDINGS)
    ).arrayBuffer();
    const cached = await caches.default.match(
      "http://localhost/images/works/42",
    );
    expect(cached?.headers.get("cache-tag")).toBe("work-image-42");
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
