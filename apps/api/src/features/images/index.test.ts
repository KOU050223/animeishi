import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { setupTestDb } from "../../test-utils/setup-db";
import * as schema from "../../db/schema";
import { images } from "./index";

// /images/* は公開ルート（認証不要）。作品画像の読み通しプロキシを担う。
// 取り込みの詳細なふるまいは lib/annict/workImage.test.ts で検証する。

const TEST_BINDINGS = {
  AVATARS: env.AVATARS,
  DB: env.DB,
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function limiter(success: boolean) {
  return { limit: vi.fn(async () => ({ success })) };
}

function requestWithLimiter(
  path: string,
  rateLimiter: ReturnType<typeof limiter>,
) {
  return buildApp().request(
    path,
    { method: "GET", headers: { "CF-Connecting-IP": "203.0.113.1" } },
    { ...TEST_BINDINGS, IMAGE_RETRY_RATE_LIMITER: rateLimiter },
  );
}

async function putImportedImage999() {
  const db = drizzle(env.DB, { schema });
  await db.insert(schema.annictWorks).values({
    annictWorkId: 999,
    title: "遅れて取り込まれた作品",
    imageR2Key: "works/999/deadbeef.png",
    updatedAt: new Date(),
  });
  await env.AVATARS.put("works/999/deadbeef.png", PNG_BYTES, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { source: "kitsu" },
  });
}

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
    await db.insert(schema.annictWorks).values({
      annictWorkId: 42,
      title: "作品",
      imageR2Key: "works/42/deadbeef.png",
      updatedAt: new Date(),
    });
    await caches.default.delete(
      "http://localhost/images/works/42?image-policy=2",
    );
    await caches.default.delete(
      "http://localhost/images/works/999?image-policy=2",
    );
    const listed = await env.AVATARS.list();
    if (listed.objects.length > 0) {
      await env.AVATARS.delete(listed.objects.map((o) => o.key));
    }
  });

  it("取り込み済みの画像を配信する", async () => {
    await env.AVATARS.put("works/42/deadbeef.png", PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { source: "kitsu" },
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
      customMetadata: { source: "kitsu" },
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

  // issue #522。クライアント（WorkImage）のリトライは ?r=N を付ける。
  // 取り込み直前に踏んだ 404 が edge に残っていても、この要求だけは
  // キャッシュを迂回してオリジンで再評価させる。
  it("?r= 付きの要求は edge の 404 を迂回してオリジンを引き直す", async () => {
    const app = buildApp();
    const miss = await app.request(
      "/images/works/999",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(miss.status).toBe(404);
    await miss.arrayBuffer();

    // 取り込みが完了した状態（行 + R2 オブジェクト）にする
    const db = drizzle(env.DB, { schema });
    await db.insert(schema.annictWorks).values({
      annictWorkId: 999,
      title: "遅れて取り込まれた作品",
      imageR2Key: "works/999/deadbeef.png",
      updatedAt: new Date(),
    });
    await env.AVATARS.put("works/999/deadbeef.png", PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { source: "kitsu" },
    });

    // ?r= なしでは edge の 404 が返り続ける
    const stillCached = await app.request(
      "/images/works/999",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(stillCached.status).toBe(404);
    await stillCached.arrayBuffer();

    // ?r= 付きはオリジンへ行き、正規キーのキャッシュも更新される
    const retried = await app.request(
      "/images/works/999?r=1",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(retried.status).toBe(200);
    expect(retried.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await retried.arrayBuffer())).toEqual(PNG_BYTES);

    const after = await app.request(
      "/images/works/999",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(after.status).toBe(200);
    await after.arrayBuffer();
  });

  // issue #244。削除スクリプトがタグ指定の Purge Cache でこのエントリを消せる
  // ようにするため、保存する側にだけ付ける（クライアントには出さない）。
  it("キャッシュに保存したレスポンスにだけ Cache-Tag が付く", async () => {
    await env.AVATARS.put("works/42/deadbeef.png", PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { source: "kitsu" },
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
    const second = await app.request(
      "/images/works/42",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(second.status).toBe(200);
    // キャッシュ HIT の応答にもタグは出さない
    expect(second.headers.get("cache-tag")).toBeNull();
    await second.arrayBuffer();
    const cached = await caches.default.match(
      "http://localhost/images/works/42?image-policy=2",
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

  // issue #713。?r= はキャッシュを飛ばしてオリジン（D1・R2・外部 API）を
  // 動かすため、IP ごとの流量制限を超えた分はオリジンへ通さない。
  describe("?r= の流量制限", () => {
    it("制限内の ?r= は IP をキーに数えてオリジンを引き直す", async () => {
      const rateLimiter = limiter(true);
      const miss = await requestWithLimiter("/images/works/999", rateLimiter);
      expect(miss.status).toBe(404);
      await miss.arrayBuffer();
      await putImportedImage999();

      const retried = await requestWithLimiter(
        "/images/works/999?r=1",
        rateLimiter,
      );
      expect(retried.status).toBe(200);
      await retried.arrayBuffer();
      expect(rateLimiter.limit).toHaveBeenCalledTimes(1);
      expect(rateLimiter.limit).toHaveBeenCalledWith({
        key: "ip:203.0.113.1",
      });
    });

    it("制限を超えた ?r= はキャッシュ済みの応答を返し、オリジンを引かない", async () => {
      const miss = await requestWithLimiter("/images/works/999", limiter(true));
      expect(miss.status).toBe(404);
      await miss.arrayBuffer();
      // オリジンを引けば 200 になる状態にしても、キャッシュの 404 が返る
      await putImportedImage999();

      const limited = await requestWithLimiter(
        "/images/works/999?r=1",
        limiter(false),
      );
      expect(limited.status).toBe(404);
      // キャッシュの 404 の Cache-Control ではなく no-store を返す。
      // リトライ URL に 404 が残ると制限解除後も再試行が API に届かなくなる。
      expect(limited.headers.get("cache-control")).toBe("no-store");
      await limited.arrayBuffer();
    });

    it("制限を超えた ?r= はキャッシュが無ければ 429 を返し、オリジンを引かない", async () => {
      // オリジンを引けば 200 になる状態
      await env.AVATARS.put("works/42/deadbeef.png", PNG_BYTES, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { source: "kitsu" },
      });

      const limited = await requestWithLimiter(
        "/images/works/42?r=1",
        limiter(false),
      );
      expect(limited.status).toBe(429);
      expect(limited.headers.get("cache-control")).toBe("no-store");
      await limited.arrayBuffer();
      // オリジンを引いていないので、正規キーのキャッシュも作られない
      expect(
        await caches.default.match(
          "http://localhost/images/works/42?image-policy=2",
        ),
      ).toBeUndefined();
    });

    it("?r= の無い要求は制限の対象にしない", async () => {
      const rateLimiter = limiter(false);
      await env.AVATARS.put("works/42/deadbeef.png", PNG_BYTES, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { source: "kitsu" },
      });

      const res = await requestWithLimiter("/images/works/42", rateLimiter);
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      expect(rateLimiter.limit).not.toHaveBeenCalled();
    });

    it.each(["0", "3", "abc", "1.5", ""])(
      "r=%s はリトライとみなさずキャッシュを経由する",
      async (r) => {
        const rateLimiter = limiter(true);
        const miss = await requestWithLimiter("/images/works/999", rateLimiter);
        expect(miss.status).toBe(404);
        await miss.arrayBuffer();
        await putImportedImage999();

        const res = await requestWithLimiter(
          `/images/works/999?r=${r}`,
          rateLimiter,
        );
        expect(res.status).toBe(404);
        // r パラメータ付きの応答は、リトライとみなさない値でもクライアントに残さない
        expect(res.headers.get("cache-control")).toBe("no-store");
        await res.arrayBuffer();
        expect(rateLimiter.limit).not.toHaveBeenCalled();
      },
    );

    it("limit() が失敗したらキャッシュ済みの応答を返し、オリジンを引かない", async () => {
      const failing = {
        limit: vi.fn(async (): Promise<{ success: boolean }> => {
          throw new Error("rate limiter unavailable");
        }),
      };
      const miss = await requestWithLimiter("/images/works/999", failing);
      expect(miss.status).toBe(404);
      await miss.arrayBuffer();
      // オリジンを引けば 200 になる状態にしても、キャッシュの 404 が返る
      await putImportedImage999();

      const retried = await requestWithLimiter(
        "/images/works/999?r=1",
        failing,
      );
      expect(retried.status).toBe(404);
      await retried.arrayBuffer();
    });

    it("limit() が失敗してもキャッシュが無ければオリジンを引く", async () => {
      const failing = {
        limit: vi.fn(async (): Promise<{ success: boolean }> => {
          throw new Error("rate limiter unavailable");
        }),
      };
      // limiter の障害で新規画像が配信できなくなるのを避けるため、
      // キャッシュが無い ?r= はオリジンへ通す（fail-open）
      await env.AVATARS.put("works/42/deadbeef.png", PNG_BYTES, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { source: "kitsu" },
      });

      const retried = await requestWithLimiter("/images/works/42?r=1", failing);
      expect(retried.status).toBe(200);
      await retried.arrayBuffer();
    });

    it("binding が未設定なら制限せずにオリジンを引き直す", async () => {
      const miss = await buildApp().request(
        "/images/works/999",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(miss.status).toBe(404);
      await miss.arrayBuffer();
      await putImportedImage999();

      const retried = await buildApp().request(
        "/images/works/999?r=2",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(retried.status).toBe(200);
      await retried.arrayBuffer();
    });
  });
});
