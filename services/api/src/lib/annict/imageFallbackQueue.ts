import type { DrizzleDb } from "@/db/client";
import { createDb } from "@/db/client";
import { authorizedDb } from "@/repository/authorizedDb";
import {
  isPlaceholderImageUrl,
  resolveImagesForWorks,
  type ImageFallbackResult,
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

  // 不正なメッセージは即 ack して捨てる。
  const jobs = new Map<Message<ImageFallbackJob>, ImageFallbackJob>();
  for (const message of batch.messages) {
    const job = parseImageFallbackJob(message.body);
    if (!job) {
      message.ack();
      continue;
    }
    jobs.set(message, job);
  }
  if (jobs.size === 0) return;

  // バッチ内の作品行をまとめて引き、解決が必要なものだけに絞る。
  // 解決不要（行なし / imageSource 済み / MAL なし / 画像 placeholder でない）
  // メッセージはここで ack する。
  const workIds = [...new Set([...jobs.values()].map((j) => j.annictWorkId))];
  const works = await adb.getAnnictWorksByIds(workIds);
  const worksById = new Map(works.map((w) => [w.annictWorkId, w]));

  const pending = new Map<
    Message<ImageFallbackJob>,
    { annictWorkId: number; malAnimeId: number }
  >();
  const targetById = new Map<number, number>();
  for (const [message, job] of jobs) {
    const work = worksById.get(job.annictWorkId);
    if (
      !work ||
      work.imageSource ||
      work.malAnimeId == null ||
      !isPlaceholderImageUrl(work.imageUrl)
    ) {
      message.ack();
      continue;
    }
    pending.set(message, {
      annictWorkId: work.annictWorkId,
      malAnimeId: work.malAnimeId,
    });
    targetById.set(work.annictWorkId, work.malAnimeId);
  }
  if (pending.size === 0) return;

  // メッセージごとに外部 API を叩くと 1 作品 = 1 AniList リクエストになり
  // 遅いため、バッチ内の対象をまとめて 1 回の resolveImagesForWorks で解く
  // （内部で AniList alias バッチ + Jikan レート制御を行う）。解決自体の
  // 失敗はバッチ内の全メッセージを retry して次のバッチに委ねる。
  let results: ImageFallbackResult[];
  try {
    results = await resolveImagesForWorks(
      [...targetById].map(([annictWorkId, malAnimeId]) => ({
        annictWorkId,
        malAnimeId,
      })),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "warn",
        event: "image_fallback_queue_retry",
        count: pending.size,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    for (const message of pending.keys()) {
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    }
    return;
  }

  const resultById = new Map(results.map((r) => [r.annictWorkId, r]));
  const resolvedAt = new Date();
  for (const [message, target] of pending) {
    const result = resultById.get(target.annictWorkId);
    // 429 / 一時障害で結果が返らなかったものは retry（ネガキャッシュしない）。
    if (!result) {
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      continue;
    }
    try {
      await adb.updateResolvedImage(result.annictWorkId, {
        resolvedImageUrl: result.resolvedImageUrl,
        imageSource: result.imageSource,
        resolvedAt,
      });
      message.ack();
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          event: "image_fallback_queue_retry",
          annictWorkId: target.annictWorkId,
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
