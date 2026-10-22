import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "@/test-utils/setup-db";
import { makeKitsuResponse } from "@/test-utils/kitsu";
import { annictWorks } from "@/db/schema";
import { IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS } from "@/lib/annict/imageFallback";
import {
  IMAGE_FALLBACK_ATTEMPT_COOLDOWN_MS,
  imageFallbackAttemptStaleBefore,
  imageFallbackNoneStaleBefore,
  resolvePendingImageFallbacks,
} from "@/lib/annict/imageFallbackPending";

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

  it("未解決行を Kitsu で解決して永続化し、attempted マーカーをクリアする", async () => {
    await insertWork(db, {
      annictWorkId: 100,
      malAnimeId: 21,
      imageUrl: "http://images.example.invalid/poster.jpg",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        makeKitsuResponse({
          m21: { coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" } },
        }),
      );

    const persisted = await resolvePendingImageFallbacks(db);

    expect(persisted).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 100),
    });
    expect(row?.resolvedImageUrl).toBe("https://media.kitsu.app/21.jpg");
    expect(row?.imageSource).toBe("kitsu");
    expect(row?.imageFallbackAttemptedAt).toBeNull();
  });

  it("Kitsu miss の作品は Jikan を呼ばず 'none' として永続化する", async () => {
    await insertWork(db, {
      annictWorkId: 200,
      malAnimeId: 9999,
      imageUrl: null,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => makeKitsuResponse({ m9999: null }));

    const persisted = await resolvePendingImageFallbacks(db);

    expect(persisted).toBe(1);
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 200),
    });
    // Workers から届かない Jikan には行かず、Kitsu に無ければその場で
    // 'none' に確定させる（再試行は resolvedAt 起点の TTL 再解決が担う）。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain("kitsu.io");
    expect(row?.resolvedImageUrl).toBeNull();
    expect(row?.imageSource).toBe("none");
    expect(row?.resolvedAt).not.toBeNull();
  });

  it("Kitsu の問い合わせ自体が失敗した作品は attempted マーカーが残り、クールダウン中は再試行しない", async () => {
    await insertWork(db, {
      annictWorkId: 300,
      malAnimeId: 8888,
      imageUrl: null,
    });
    // Kitsu が 5xx → 結果なし（pending のまま残る。'none' にはしない）
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("boom", { status: 503 }));

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
        makeKitsuResponse({
          m21: { coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" } },
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
      // TTL 内の 'none' は再解決対象にしない
      resolvedAt: new Date(),
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

  it("imageSource='none' で resolvedAt が TTL を超えた作品は再解決対象になる", async () => {
    await insertWork(db, {
      annictWorkId: 700,
      malAnimeId: 21,
      imageUrl: null,
      imageSource: "none",
      resolvedAt: new Date(
        Date.now() - IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS - 1000,
      ),
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeKitsuResponse({
        m21: { coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" } },
      }),
    );

    const persisted = await resolvePendingImageFallbacks(db);

    // 'none' 確定後に Kitsu 側へ画像が登録されたケースを拾い直す
    expect(persisted).toBe(1);
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 700),
    });
    expect(row?.imageSource).toBe("kitsu");
    expect(row?.resolvedImageUrl).toBe("https://media.kitsu.app/21.jpg");
  });

  it("'none' の再解決で依然 Kitsu に無ければ resolvedAt だけ更新され、TTL が先送りされる", async () => {
    const staleResolvedAt = new Date(
      Date.now() - IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS - 1000,
    );
    await insertWork(db, {
      annictWorkId: 800,
      malAnimeId: 9999,
      imageUrl: null,
      imageSource: "none",
      resolvedAt: staleResolvedAt,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => makeKitsuResponse({ m9999: null }));

    const persisted = await resolvePendingImageFallbacks(db);

    expect(persisted).toBe(1);
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 800),
    });
    expect(row?.imageSource).toBe("none");
    // resolved_at は秒精度で保存されるため、元の値より新しいかで判定する
    expect(row?.resolvedAt?.getTime()).toBeGreaterThan(
      staleResolvedAt.getTime(),
    );

    // resolvedAt が新しくなったので、直後の実行では対象外になる
    fetchMock.mockClear();
    expect(await resolvePendingImageFallbacks(db)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
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

describe("imageFallbackNoneStaleBefore", () => {
  it("現在時刻から 'none' の再解決間隔を引いた境界時刻を返す", () => {
    const now = new Date("2025-07-01T00:00:00Z");
    expect(imageFallbackNoneStaleBefore(now).getTime()).toBe(
      now.getTime() - IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS,
    );
  });
});
