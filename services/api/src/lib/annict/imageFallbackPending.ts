import type { DrizzleDb } from "@/db/client";
import { authorizedDb } from "@/repository/authorizedDb";
import { resolveImagesForWorks } from "@/lib/annict/imageFallback";

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

/**
 * 1 回の実行で解決する作品数の上限。
 * Jikan フォールバックは直列（レート制限）なので件数を抑え、
 * 頻度（cron 間隔）で回収速度を稼ぐ。
 */
const PENDING_RESOLVE_LIMIT = 40;

const SYSTEM_USER_ID = "__image_fallback_cron__";

/**
 * image_source 未解決の作品を D1 から引いて AniList / Jikan で解決・永続化する。
 * cron ハンドラから定期実行される。
 *
 * issue #127 までは Cloudflare Queues にジョブを積んでいたが、「未解決作品の
 * 集合」は image_source / image_url の状態として D1 上に既に表現されている。
 * Queue を挟むとメッセージ単位の ops 課金（Free プラン 10k ops/day）・
 * 重複投入・再配送の増殖が発生したため、Queue を廃止して pending 集合を
 * 直接処理する設計にした。
 *
 * 試行前に attempted マーカーを立ててクールダウンを適用する（解決成功時は
 * image_source が立つため pending から自然に外れる）。
 */
export async function resolvePendingImageFallbacks(
  db: DrizzleDb,
  limit = PENDING_RESOLVE_LIMIT,
): Promise<number> {
  const adb = authorizedDb(db, SYSTEM_USER_ID);
  const targets = await adb.getPendingImageFallbackWorks(
    limit,
    imageFallbackAttemptStaleBefore(),
  );
  if (targets.length === 0) return 0;

  // 実行中の中断や解決失敗が次回実行での即時リトライにならないよう、
  // 試行前に attempted マーカーを立てる（クールダウン）。
  await adb.markImageFallbackAttempted(
    targets.map((t) => t.annictWorkId),
    new Date(),
  );

  let results;
  try {
    results = await resolveImagesForWorks(targets);
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
      await adb.updateResolvedImage(result.annictWorkId, {
        resolvedImageUrl: result.resolvedImageUrl,
        imageSource: result.imageSource,
        resolvedAt,
      });
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
