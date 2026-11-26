import type { DrizzleDb } from "@/db/client";
import { worksRepository } from "@/features/works/repository";
import { isD1InternalError, withD1InternalErrorRetry } from "@/lib/d1/retry";
import {
  IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS,
  resolveImagesForWorks,
} from "./imageFallback";

/**
 * 最終試行時刻（annict_works.image_fallback_attempted_at）のクールダウン期間。
 * この間は getPendingImageFallbackWorks の対象外になる。
 * 429 等で解決できなかった作品が cron のたび叩き直されるのを防ぐ。
 */
export const IMAGE_FALLBACK_ATTEMPT_COOLDOWN_MS = 60 * 60 * 1000;

/** クールダウンが「切れた」とみなす境界時刻を返す。 */
export function imageFallbackAttemptStaleBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - IMAGE_FALLBACK_ATTEMPT_COOLDOWN_MS);
}

/** 'none' の再解決対象になる境界時刻を返す。 */
export function imageFallbackNoneStaleBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS);
}

/**
 * 1 回の実行で解決する作品数の上限。
 * Kitsu は 20 件/リクエストのバッチで取れるが、未解決の溜まりを
 * 一度に全部回さず頻度（cron 間隔）で回収速度を稼ぐ。
 */
const PENDING_RESOLVE_LIMIT = 40;

// D1 internal error が 2 回続いたときの warn ログ。ログだけ残して
// ジョブは次回 cron に回す（Sentry に送り続けない。issue #833）。
function warnImageFallbackDeferred(stage: string, err: unknown): void {
  console.error(
    JSON.stringify({
      level: "warn",
      event: "image_fallback_deferred",
      stage,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/**
 * image_source 未解決（null）または 'none' で TTL 切れの作品を D1 から引いて
 * Kitsu（無ければ MAL API）で解決・永続化する。cron ハンドラから定期実行される。
 *
 * issue #127 までは Cloudflare Queues にジョブを積んでいたが、「未解決作品の
 * 集合」は image_source / image_url の状態として D1 上に既に表現されている。
 * Queue を挟むとメッセージ単位の ops 課金（Free プラン 10k ops/day）・
 * 重複投入・再配送の増殖が発生したため、Queue を廃止して pending 集合を
 * 直接処理する設計にした。
 *
 * 試行前に attempted マーカーを立ててクールダウンを適用する（解決成功時は
 * image_source が立つため pending から自然に外れる）。
 *
 * D1 の internal error はストレージ層の一過性エラーが大半なので、D1 呼び出しは
 * 1 回だけ実行し直す。それでも失敗した場合はこの実行を諦めて次回 cron に回す
 * （画像はキャッシュ的な補完データで、1 回分の遅延で済むため。issue #833）。
 * internal error 以外の失敗は握らず投げ、runCronJob 経由で Sentry に送る。
 */
export async function resolvePendingImageFallbacks(
  db: DrizzleDb,
  limit = PENDING_RESOLVE_LIMIT,
  options: { malClientId?: string | undefined; fetchImpl?: typeof fetch } = {},
): Promise<number> {
  const repo = worksRepository(db);
  let targets: Awaited<ReturnType<typeof repo.getPendingImageFallbackWorks>>;
  try {
    targets = await withD1InternalErrorRetry(() =>
      repo.getPendingImageFallbackWorks(
        limit,
        imageFallbackAttemptStaleBefore(),
        imageFallbackNoneStaleBefore(),
      ),
    );
  } catch (err) {
    if (!isD1InternalError(err)) throw err;
    warnImageFallbackDeferred("get_pending_image_fallback_works", err);
    return 0;
  }
  if (targets.length === 0) return 0;

  // 実行中の中断や解決失敗が次回実行での即時リトライにならないよう、
  // 試行前に attempted マーカーを立てる（クールダウン）。
  try {
    await withD1InternalErrorRetry(() =>
      repo.markImageFallbackAttempted(
        targets.map((t) => t.annictWorkId),
        new Date(),
      ),
    );
  } catch (err) {
    if (!isD1InternalError(err)) throw err;
    warnImageFallbackDeferred("mark_image_fallback_attempted", err);
    return 0;
  }

  let results;
  try {
    results = await resolveImagesForWorks(targets, options.fetchImpl, {
      malClientId: options.malClientId,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "warn",
        event: "image_fallback_resolve_failed",
        count: targets.length,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return 0;
  }

  const resolvedAt = new Date();
  let persisted = 0;
  for (const result of results) {
    try {
      await withD1InternalErrorRetry(() =>
        repo.updateResolvedImage(result.annictWorkId, {
          resolvedImageUrl: result.resolvedImageUrl,
          imageSource: result.imageSource,
          resolvedAt,
        }),
      );
      persisted++;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          event: "image_fallback_persist_failed",
          annictWorkId: result.annictWorkId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return persisted;
}
