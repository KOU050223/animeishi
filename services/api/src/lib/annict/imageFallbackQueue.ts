import type { DrizzleDb } from "@/db/client";
import { createDb } from "@/db/client";
import { authorizedDb } from "@/repository/authorizedDb";
import {
  isPlaceholderImageUrl,
  resolveImagesForWorks,
} from "@/lib/annict/imageFallback";

export type ImageFallbackJobReason = "search" | "watch-history" | "cron";

export type ImageFallbackJob = {
  annictWorkId: number;
  malAnimeId: number;
  reason: ImageFallbackJobReason;
};

type ImageFallbackQueue = Queue<ImageFallbackJob>;

const QUEUE_BATCH_SIZE = 100;
const RETRY_DELAY_SECONDS = 300;
const SYSTEM_USER_ID = "__image_fallback_worker__";

export async function enqueueImageFallbackJobs(
  queue: Pick<ImageFallbackQueue, "sendBatch"> | null | undefined,
  targets: { annictWorkId: number; malAnimeId: number }[],
  reason: ImageFallbackJobReason,
): Promise<number> {
  if (!queue || targets.length === 0) return 0;

  const jobs = dedupeTargets(targets).map((target) => ({
    body: { ...target, reason },
  }));

  let sent = 0;
  for (let i = 0; i < jobs.length; i += QUEUE_BATCH_SIZE) {
    const chunk = jobs.slice(i, i + QUEUE_BATCH_SIZE);
    try {
      await queue.sendBatch(chunk);
      sent += chunk.length;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          event: "image_fallback_enqueue_failed",
          reason,
          count: chunk.length,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return sent;
}

export async function enqueuePendingImageFallbackJobs(
  db: DrizzleDb,
  queue: Pick<ImageFallbackQueue, "sendBatch"> | null | undefined,
  limit = 20,
): Promise<number> {
  const targets = await authorizedDb(
    db,
    SYSTEM_USER_ID,
  ).getPendingImageFallbackWorks(limit);
  return enqueueImageFallbackJobs(queue, targets, "cron");
}

export async function handleImageFallbackQueue(
  batch: MessageBatch<ImageFallbackJob>,
  env: { DB: unknown },
): Promise<void> {
  const db = createDb(env.DB as D1Database);
  const adb = authorizedDb(db, SYSTEM_USER_ID);

  for (const message of batch.messages) {
    const job = parseImageFallbackJob(message.body);
    if (!job) {
      message.ack();
      continue;
    }

    try {
      const work = await adb.getAnnictWorkById(job.annictWorkId);
      if (
        !work ||
        work.imageSource ||
        work.malAnimeId == null ||
        !isPlaceholderImageUrl(work.imageUrl)
      ) {
        message.ack();
        continue;
      }

      const malAnimeId = work.malAnimeId;
      const results = await resolveImagesForWorks([
        { annictWorkId: work.annictWorkId, malAnimeId },
      ]);
      const result = results.find((r) => r.annictWorkId === work.annictWorkId);
      if (!result) {
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
        continue;
      }

      await adb.updateResolvedImage(result.annictWorkId, {
        resolvedImageUrl: result.resolvedImageUrl,
        imageSource: result.imageSource,
        resolvedAt: new Date(),
      });
      message.ack();
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          event: "image_fallback_queue_retry",
          annictWorkId: job.annictWorkId,
          reason: job.reason,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    }
  }
}

function dedupeTargets(
  targets: { annictWorkId: number; malAnimeId: number }[],
): { annictWorkId: number; malAnimeId: number }[] {
  const seen = new Set<number>();
  const out: { annictWorkId: number; malAnimeId: number }[] = [];
  for (const target of targets) {
    if (
      !Number.isSafeInteger(target.annictWorkId) ||
      target.annictWorkId <= 0 ||
      !Number.isSafeInteger(target.malAnimeId) ||
      target.malAnimeId <= 0 ||
      seen.has(target.annictWorkId)
    ) {
      continue;
    }
    seen.add(target.annictWorkId);
    out.push(target);
  }
  return out;
}

function parseImageFallbackJob(body: unknown): ImageFallbackJob | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Partial<ImageFallbackJob>;
  const annictWorkId = raw.annictWorkId;
  const malAnimeId = raw.malAnimeId;
  const reason = raw.reason;
  if (
    typeof annictWorkId !== "number" ||
    !Number.isSafeInteger(annictWorkId) ||
    annictWorkId <= 0 ||
    typeof malAnimeId !== "number" ||
    !Number.isSafeInteger(malAnimeId) ||
    malAnimeId <= 0 ||
    !isImageFallbackReason(reason)
  ) {
    return null;
  }
  return {
    annictWorkId,
    malAnimeId,
    reason,
  };
}

function isImageFallbackReason(
  value: unknown,
): value is ImageFallbackJobReason {
  return value === "search" || value === "watch-history" || value === "cron";
}
