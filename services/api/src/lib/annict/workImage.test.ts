import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test-utils/setup-db";
import { annictWorks } from "@/db/schema";
import {
  WORK_IMAGE_FAILURE_COOLDOWN_MS,
  serveWorkImage,
  workImageKey,
  workImageSourceCandidates,
  workImageUrl,
} from "@/lib/annict/workImage";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function makeImageResponse(
  contentType: string | null = "image/png",
  init: { status?: number; contentLength?: number } = {},
): Response {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  if (init.contentLength != null) {
    headers.set("content-length", String(init.contentLength));
  }
  return new Response(PNG_BYTES, { status: init.status ?? 200, headers });
}

function makeAnilistResponse(malId: number, cover: string | null): Response {
  const media = cover
    ? [{ idMal: malId, coverImage: { extraLarge: cover } }]
    : [];
  return new Response(JSON.stringify({ data: { Page: { media } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type Db = Awaited<ReturnType<typeof setupTestDb>>;

async function insertWork(
  db: Db,
  overrides: Partial<typeof annictWorks.$inferInsert> = {},
) {
  const values = {
    annictWorkId: 1,
    title: "作品",
    updatedAt: new Date(),
    ...overrides,
  };
  await db.insert(annictWorks).values(values);
  return values.annictWorkId;
}

async function getWork(db: Db, annictWorkId = 1) {
  const [row] = await db
    .select()
    .from(annictWorks)
    .where(eq(annictWorks.annictWorkId, annictWorkId));
  return row;
}

// URL ごとの応答を決め打ちする fetch。未定義の URL は 404。
function routeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  });
}

describe("workImageSourceCandidates", () => {
  it("https の実画像と補完 URL をどちらも候補に含める", () => {
    const candidates = workImageSourceCandidates({
      imageUrl: "https://img.example.com/poster.png",
      resolvedImageUrl: "https://s4.anilist.co/1.jpg",
    });
    expect(candidates).toEqual(
      expect.arrayContaining([
        "https://img.example.com/poster.png",
        "https://s4.anilist.co/1.jpg",
      ]),
    );
  });

  it("SNS アバターは作品画像ではないので候補にしない", () => {
    expect(
      workImageSourceCandidates({
        imageUrl: "https://pbs.twimg.com/profile_images/1/avatar.jpg",
        resolvedImageUrl: null,
      }),
    ).toEqual([]);
  });

  it("内部宛先・非 https スキームは候補にしない（SSRF 対策）", () => {
    for (const imageUrl of [
      "https://10.0.0.1/x.png",
      "https://169.254.169.254/latest/meta-data.png",
      "https://localhost/x.png",
      "https://img.example.com:8443/x.png",
      "javascript:alert(1)",
      "data:image/png;base64,iVBORw0KGgo=",
    ]) {
      expect(
        workImageSourceCandidates({ imageUrl, resolvedImageUrl: null }),
      ).toEqual([]);
    }
  });

  it("どの候補も https の公開ホストで、重複を含まない", () => {
    const candidates = workImageSourceCandidates({
      imageUrl: "http://youjo-senki.jp/og-image.jpg",
      resolvedImageUrl: "https://s4.anilist.co/1.jpg",
    });
    for (const url of candidates) expect(url).toMatch(/^https:\/\//);
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates).toContain("https://s4.anilist.co/1.jpg");
  });

  it("何も無ければ空配列", () => {
    expect(
      workImageSourceCandidates({ imageUrl: null, resolvedImageUrl: null }),
    ).toEqual([]);
    expect(
      workImageSourceCandidates({ imageUrl: "", resolvedImageUrl: undefined }),
    ).toEqual([]);
  });
});

describe("workImageUrl", () => {
  it("リクエスト先オリジンに /images/works/<id> を載せる", () => {
    expect(workImageUrl("https://api.example.com/works/search?q=a", 42)).toBe(
      "https://api.example.com/images/works/42",
    );
  });

  it("ID が無ければ null", () => {
    expect(workImageUrl("https://api.example.com/", null)).toBeNull();
    expect(workImageUrl("https://api.example.com/", undefined)).toBeNull();
  });
});

describe("serveWorkImage", () => {
  let db: Db;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    const listed = await env.AVATARS.list();
    if (listed.objects.length > 0) {
      await env.AVATARS.delete(listed.objects.map((o) => o.key));
    }
  });

  it("annict_works に無い作品は外部を叩かず 404", async () => {
    const fetchImpl = vi.fn();
    const res = await serveWorkImage(db, env.AVATARS, 999, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("取り込み済みなら R2 から返し、外部を叩かない", async () => {
    const key = "works/1/deadbeef.png";
    await env.AVATARS.put(key, PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertWork(db, { imageR2Key: key });
    const fetchImpl = vi.fn();

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toMatch(/max-age=86400/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("未取り込みなら外部から取得して R2 に保存し、キーを記録する", async () => {
    const source = "https://s4.anilist.co/1.jpg";
    await insertWork(db, { resolvedImageUrl: source });
    const fetchImpl = routeFetch({ [source]: () => makeImageResponse() });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    const expectedKey = workImageKey(1, source, "png");
    expect((await getWork(db)).imageR2Key).toBe(expectedKey);
    const stored = await env.AVATARS.get(expectedKey);
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
  });

  it("Annict の URL が実際には 404 でも、補完 URL で取り込める", async () => {
    // 本番で欠損が多かった原因: URL の見た目はまともで placeholder 判定に
    // 掛からないが、実体は消えている公式サイト画像。
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      resolvedImageUrl: "https://s4.anilist.co/1.jpg",
    });
    const fetchImpl = routeFetch({
      "https://s4.anilist.co/1.jpg": () => makeImageResponse("image/jpeg"),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect((await getWork(db)).imageR2Key).toBe(
      workImageKey(1, "https://s4.anilist.co/1.jpg", "jpg"),
    );
  });

  it("候補が全滅で未解決なら AniList を引き直し、その画像を取り込む", async () => {
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      malAnimeId: 5114,
    });
    const cover = "https://s4.anilist.co/5114.jpg";
    const fetchImpl = routeFetch({
      "https://graphql.anilist.co": () => makeAnilistResponse(5114, cover),
      [cover]: () => makeImageResponse("image/jpeg"),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    const row = await getWork(db);
    expect(row.resolvedImageUrl).toBe(cover);
    expect(row.imageSource).toBe("anilist");
    expect(row.imageR2Key).toBe(workImageKey(1, cover, "jpg"));
  });

  it("全滅したら 404 を返して試行時刻を立て、クールダウン中は外部を叩かない", async () => {
    await insertWork(db, { resolvedImageUrl: "https://s4.anilist.co/1.jpg" });
    const now = new Date("2026-10-17T00:00:00Z");
    const fetchImpl = routeFetch({});

    const first = await serveWorkImage(db, env.AVATARS, 1, {
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(first.status).toBe(404);
    expect(first.headers.get("cache-control")).toMatch(/max-age=300/);
    expect((await getWork(db)).imageR2AttemptedAt?.getTime()).toBe(
      now.getTime(),
    );

    fetchImpl.mockClear();
    const second = await serveWorkImage(db, env.AVATARS, 1, {
      now: new Date(now.getTime() + 60_000),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(second.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();

    // クールダウン明けは再挑戦する
    await serveWorkImage(db, env.AVATARS, 1, {
      now: new Date(now.getTime() + WORK_IMAGE_FAILURE_COOLDOWN_MS + 1),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("画像でない Content-Type・サイズ超過は取り込まない", async () => {
    await insertWork(db, { resolvedImageUrl: "https://s4.anilist.co/1.jpg" });
    for (const response of [
      () => makeImageResponse("text/html"),
      () => makeImageResponse("image/svg+xml"),
      () => makeImageResponse("image/png", { contentLength: 10 * 1024 * 1024 }),
    ]) {
      await db
        .update(annictWorks)
        .set({ imageR2AttemptedAt: null })
        .where(eq(annictWorks.annictWorkId, 1));
      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: routeFetch({
          "https://s4.anilist.co/1.jpg": response,
        }) as unknown as typeof fetch,
      });
      expect(res.status).toBe(404);
      expect((await getWork(db)).imageR2Key).toBeNull();
    }
  });

  it("リダイレクト先が内部宛先なら追わない（SSRF 対策）", async () => {
    await insertWork(db, { resolvedImageUrl: "https://s4.anilist.co/1.jpg" });
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/meta.png" },
        }),
    );

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("キーはあるが R2 のオブジェクトが消えていれば取り込み直す", async () => {
    const source = "https://s4.anilist.co/1.jpg";
    await insertWork(db, {
      resolvedImageUrl: source,
      imageR2Key: "works/1/0badf00d.png",
    });
    const fetchImpl = routeFetch({ [source]: () => makeImageResponse() });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect((await getWork(db)).imageR2Key).toBe(workImageKey(1, source, "png"));
  });
});
