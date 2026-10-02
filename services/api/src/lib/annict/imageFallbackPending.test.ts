import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "@/test-utils/setup-db";
import { annictWorks } from "@/db/schema";
import {
  IMAGE_FALLBACK_ATTEMPT_COOLDOWN_MS,
  imageFallbackAttemptStaleBefore,
  resolvePendingImageFallbacks,
} from "@/lib/annict/imageFallbackPending";

// 決めうちの AniList JSON レスポンスを組み立てる。
function makeAnilistResponse(
  entries: Record<
    string,
    { coverImage?: { extraLarge?: string | null } | null } | null
  >,
): Response {
  return new Response(JSON.stringify({ data: entries }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeJikanResponse(
  images: {
    jpg?: { large_image_url?: string | null; image_url?: string | null };
  } | null,
  status = 200,
): Response {
  return new Response(JSON.stringify({ data: { images } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function insertWork(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  overrides: Partial<typeof annictWorks.$inferInsert> = {},
) {
  const now = new Date();
  const values = {
    annictWorkId: 1,
    title: "作品",
    updatedAt: now,
    ...overrides,
  };
  await db.insert(annictWorks).values(values);
  return values.annictWorkId;
}

describe("resolvePendingImageFallbacks", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("未解決行を AniList で解決して永続化し、attempted マーカーをクリアする", async () => {
    await insertWork(db, {
      annictWorkId: 100,
      malAnimeId: 21,
      imageUrl: "http://images.example.invalid/poster.jpg",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        makeAnilistResponse({
          m21: { coverImage: { extraLarge: "https://s4.anilist.co/21.jpg" } },
        }),
      );

    const persisted = await resolvePendingImageFallbacks(db);

    expect(persisted).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 100),
    });
    expect(row?.resolvedImageUrl).toBe("https://s4.anilist.co/21.jpg");
    expect(row?.imageSource).toBe("anilist");
    expect(row?.imageFallbackAttemptedAt).toBeNull();
  });

  it("AniList miss の作品は Jikan で解決する", async () => {
    await insertWork(db, {
      annictWorkId: 200,
      malAnimeId: 9999,
      imageUrl: null,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === "https://graphql.anilist.co") {
        return makeAnilistResponse({ m9999: null });
      }
      return makeJikanResponse({
        jpg: { large_image_url: "https://cdn.myanimelist.net/9999.jpg" },
      });
    });

    const persisted = await resolvePendingImageFallbacks(db);

    expect(persisted).toBe(1);
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 200),
    });
    expect(row?.resolvedImageUrl).toBe("https://cdn.myanimelist.net/9999.jpg");
    expect(row?.imageSource).toBe("jikan");
  });

  it("解決できなかった作品は attempted マーカーが残り、クールダウン中は再試行しない", async () => {
    await insertWork(db, {
      annictWorkId: 300,
      malAnimeId: 8888,
      imageUrl: null,
    });
    // AniList miss + Jikan 429 → 結果なし（pending のまま残る）
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url === "https://graphql.anilist.co") {
          return makeAnilistResponse({ m8888: null });
        }
        return new Response("Too Many Requests", { status: 429 });
      });

    const first = await resolvePendingImageFallbacks(db);
    expect(first).toBe(0);

    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 300),
    });
    // 未解決のままだが attempted マーカーは立っている
    expect(row?.imageSource).toBeNull();
    expect(row?.imageFallbackAttemptedAt).not.toBeNull();

    // クールダウン中は pending 対象外 → fetch されない
    fetchMock.mockClear();
    const second = await resolvePendingImageFallbacks(db);
    expect(second).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("クールダウン切れの作品は再試行される", async () => {
    const stale = new Date(
      Date.now() - IMAGE_FALLBACK_ATTEMPT_COOLDOWN_MS - 1000,
    );
    await insertWork(db, {
      annictWorkId: 400,
      malAnimeId: 21,
      imageUrl: null,
      imageFallbackAttemptedAt: stale,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        makeAnilistResponse({
          m21: { coverImage: { extraLarge: "https://s4.anilist.co/21.jpg" } },
        }),
      );

    const persisted = await resolvePendingImageFallbacks(db);

    expect(persisted).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("解決済み / MAL ID なし / 画像が非 placeholder の行は対象外", async () => {
    await insertWork(db, {
      annictWorkId: 500,
      malAnimeId: 21,
      imageUrl: null,
      imageSource: "none",
    });
    await insertWork(db, {
      annictWorkId: 501,
      malAnimeId: null,
      imageUrl: null,
    });
    await insertWork(db, {
      annictWorkId: 502,
      malAnimeId: 21,
      imageUrl: "https://shonenjumpplus.com/uploads/poster.png",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const persisted = await resolvePendingImageFallbacks(db);

    expect(persisted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("外部 API が全滅しても落ちず、結果は永続化せずネガキャッシュもしない", async () => {
    await insertWork(db, {
      annictWorkId: 600,
      malAnimeId: 21,
      imageUrl: null,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network down");
    });

    const persisted = await resolvePendingImageFallbacks(db);

    // ネットワーク失敗は一時障害として結果を返さない（'none' にはしない）。
    // 試行は記録されているためクールダウン切れ後に再試行される。
    expect(persisted).toBe(0);
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 600),
    });
    expect(row?.imageSource).toBeNull();
    expect(row?.imageFallbackAttemptedAt).not.toBeNull();
  });
});

describe("imageFallbackAttemptStaleBefore", () => {
  it("現在時刻からクールダウン期間を引いた境界時刻を返す", () => {
    const now = new Date("2025-07-01T00:00:00Z");
    expect(imageFallbackAttemptStaleBefore(now).getTime()).toBe(
      now.getTime() - IMAGE_FALLBACK_ATTEMPT_COOLDOWN_MS,
    );
  });
});
