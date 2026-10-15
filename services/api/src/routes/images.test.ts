import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { images } from "./images";

// /images/* は公開ルート（認証不要）。作品画像の R2 配信を担う（issue #174）。
// アバター配信（GET /me/profile/avatar/*）と同じく immutable キャッシュ前提。

const TEST_BINDINGS = {
  AVATARS: env.AVATARS,
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function buildApp() {
  const app = applyApiErrorHandling(
    new Hono<{ Bindings: { AVATARS: R2Bucket } }>(),
  );
  app.route("/images", images);
  return app;
}

describe("GET /images/works/*（作品画像の R2 配信）", () => {
  beforeEach(async () => {
    // R2 オブジェクトがテスト間で残らないよう掃除する。
    const listed = await env.AVATARS.list();
    if (listed.objects.length > 0) {
      await env.AVATARS.delete(listed.objects.map((o) => o.key));
    }
  });

  it("保存済みの画像を immutable キャッシュ付きで配信する", async () => {
    await env.AVATARS.put("works/42/deadbeef.png", PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
    });
    const app = buildApp();
    const res = await app.request(
      "/images/works/42/deadbeef.png",
      { method: "GET" },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("存在しないキーは 404", async () => {
    const app = buildApp();
    const res = await app.request(
      "/images/works/42/deadbeef.png",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("works/ 以外のプレフィックス（アバター等）には到達できない", async () => {
    // 同じバケットのアバター画像を置いておき、/images/ 経由で
    // 取り出せないことを確認する（キー形式チェックで弾く）。
    await env.AVATARS.put("avatars/u1/icon.webp", PNG_BYTES, {
      httpMetadata: { contentType: "image/webp" },
    });
    const app = buildApp();
    const res = await app.request(
      "/images/avatars/u1/icon.webp",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("形式に合わないキー（非数値 ID / パストラバーサル風）は 404", async () => {
    const app = buildApp();
    for (const path of [
      "/images/works/abc/deadbeef.png",
      "/images/works/42/not-hex!.png",
      "/images/works/42/../../avatars/u1/icon.webp",
      "/images/works/42/deadbeef.svg",
    ]) {
      const res = await app.request(path, { method: "GET" }, TEST_BINDINGS);
      expect(res.status).toBe(404);
    }
  });
});
