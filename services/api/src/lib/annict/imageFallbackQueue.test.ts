import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "../../test-utils/setup-db";
import { createDb } from "@/db/client";
import { annictWorks } from "@/db/schema";
import {
  enqueueImageFallbackJobs,
  enqueuePendingImageFallbackJobs,
  handleImageFallbackQueue,
} from "@/lib/annict/imageFallbackQueue";

describe("image fallback queue", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.restoreAllMocks();
  });

  it("enqueueImageFallbackJobs: Queue message を最小形で batch 送信する", async () => {
    const sendBatch = vi.fn().mockResolvedValue(undefined);

    await enqueueImageFallbackJobs(
      { sendBatch },
      [{ annictWorkId: 1, malAnimeId: 100 }],
      "search",
    );

    expect(sendBatch).toHaveBeenCalledWith([
      { body: { annictWorkId: 1, malAnimeId: 100, reason: "search" } },
    ]);
  });

  it("enqueueImageFallbackJobs: Queue 送信失敗は API 本体を壊さないよう握る", async () => {
    const sendBatch = vi.fn().mockRejectedValue(new Error("queue down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const count = await enqueueImageFallbackJobs(
      { sendBatch },
      [{ annictWorkId: 1, malAnimeId: 100 }],
      "search",
    );

    expect(count).toBe(0);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("image_fallback_enqueue_failed"),
    );
  });

  it("handleImageFallbackQueue: 未解決行を補完して ack する", async () => {
    await db.insert(annictWorks).values({
      annictWorkId: 1,
      malAnimeId: 100,
      title: "補完対象",
      imageUrl: null,
      updatedAt: new Date(),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            m100: {
              coverImage: { extraLarge: "https://img.example/anilist.jpg" },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const ack = vi.fn();
    const retry = vi.fn();

    await handleImageFallbackQueue(
      batch([{ annictWorkId: 1, malAnimeId: 100, reason: "search" }], {
        ack,
        retry,
      }),
      { DB: env.DB },
    );

    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 1),
    });
    expect(row?.resolvedImageUrl).toBe("https://img.example/anilist.jpg");
    expect(row?.imageSource).toBe("anilist");
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("handleImageFallbackQueue: 既に image_source があれば冪等 no-op で ack する", async () => {
    await db.insert(annictWorks).values({
      annictWorkId: 2,
      malAnimeId: 200,
      title: "補完済み",
      imageUrl: null,
      resolvedImageUrl: "https://img.example/cached.jpg",
      imageSource: "anilist",
      resolvedAt: new Date(),
      updatedAt: new Date(),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const ack = vi.fn();
    const retry = vi.fn();

    await handleImageFallbackQueue(
      batch([{ annictWorkId: 2, malAnimeId: 200, reason: "watch-history" }], {
        ack,
        retry,
      }),
      { DB: env.DB },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("handleImageFallbackQueue: 一時障害で結果が無いと retry する", async () => {
    await db.insert(annictWorks).values({
      annictWorkId: 3,
      malAnimeId: 300,
      title: "一時障害",
      imageUrl: null,
      updatedAt: new Date(),
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const ack = vi.fn();
    const retry = vi.fn();

    await handleImageFallbackQueue(
      batch([{ annictWorkId: 3, malAnimeId: 300, reason: "search" }], {
        ack,
        retry,
      }),
      { DB: env.DB },
    );

    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 3),
    });
    expect(row?.imageSource).toBeNull();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(ack).not.toHaveBeenCalled();
  });

  it("enqueuePendingImageFallbackJobs: Cron 用に未解決候補だけ少量 enqueue する", async () => {
    const now = new Date();
    await db.insert(annictWorks).values([
      {
        annictWorkId: 10,
        malAnimeId: 1010,
        title: "HTTP 画像",
        imageUrl: "http://img.example/10.jpg",
        updatedAt: now,
      },
      {
        annictWorkId: 11,
        malAnimeId: 1111,
        title: "解決済み",
        imageUrl: null,
        imageSource: "none",
        resolvedAt: now,
        updatedAt: now,
      },
      {
        annictWorkId: 12,
        malAnimeId: null,
        title: "MAL なし",
        imageUrl: null,
        updatedAt: now,
      },
    ]);
    const sendBatch = vi.fn().mockResolvedValue(undefined);

    const count = await enqueuePendingImageFallbackJobs(
      createDb(env.DB),
      { sendBatch },
      5,
    );

    expect(count).toBe(1);
    expect(sendBatch).toHaveBeenCalledWith([
      { body: { annictWorkId: 10, malAnimeId: 1010, reason: "cron" } },
    ]);
  });
});

function batch(
  bodies: { annictWorkId: number; malAnimeId: number; reason: string }[],
  hooks: { ack: () => void; retry: (options?: QueueRetryOptions) => void },
): MessageBatch {
  return {
    queue: "animeishi-image-fallback",
    messages: bodies.map((body, index) => ({
      id: `msg-${index}`,
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: hooks.ack,
      retry: hooks.retry,
    })),
    metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}
