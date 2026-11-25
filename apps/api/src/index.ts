import * as Sentry from "@sentry/cloudflare";
import { routes, type AppBindings } from "./app";
import { createDb } from "./db/client";
import { resolvePendingImageFallbacks } from "./lib/catalog/imageFallbackPending";
import { resolveMissingMalIds } from "./lib/providers/kitsu/titleSearch";
import { resolvePendingWorkGenres } from "./lib/catalog/workGenres";
import { buildSentryOptions, runCronJob } from "./observability";

// Hono アプリの組み立て（ミドルウェア・ルート登録）は ./app に分離している。
// そちらは cloudflare:* モジュールを import しないため、Workers ランタイムの
// 外（OpenAPI 仕様の書き出しスクリプト等）からでも routes を読める。
// このファイルは Worker のエントリポイントとして Sentry・Cron・Workflows の
// エクスポートだけを担う。
export { routes } from "./app";
export type { AppType } from "./app";

// Cloudflare Workflows（dアニメ話記録ジョブ, issue #477）。
// wrangler.toml の [[workflows]] class_name がこの名前付きエクスポートを参照する。
export { DanimeEpisodeImportWorkflow } from "./features/import/episodeImportWorkflow";

// withSentry が fetch / scheduled の全ハンドラを instrument する。
// ハンドラの外に漏れた例外は SDK が自動で capture し、app.onError で
// 応答に変換した例外は handleError 側で明示的に capture する。
export default Sentry.withSentry((env) => buildSentryOptions(env), {
  fetch: routes.fetch,
  // 画像フォールバックは Queue を介さず、cron が D1 の未解決行を
  // 直接回して解決する（issue #127）。作品画像の R2 取り込みは cron ではなく
  // 画像プロキシ（GET /images/works/:id）が表示時に行う。
  // 先に MAL ID を持たない作品を Kitsu のタイトル検索で補い
  // （issue #223 / #227。AniList は Workers から 403 で拒否されるため
  // Kitsu を使う）、見つかった作品を同じ実行の画像フォールバック解決に
  // 乗せる。runCronJob がジョブごとに例外を握り、失敗を Sentry と
  // （連続失敗時は）Discord に送る（issue #233）。
  scheduled(_controller, env, ctx) {
    const db = createDb(env.DB as D1Database);
    ctx.waitUntil(
      (async () => {
        await runCronJob(env, "mal_id_search", () => resolveMissingMalIds(db));
        await runCronJob(env, "image_fallback", () =>
          resolvePendingImageFallbacks(db, undefined, {
            malClientId: env.MAL_CLIENT_ID,
          }),
        );
        // ジャンル・タグの取り込み（issue #346）。mal_id_search が
        // kitsu_anime_id / mal_anime_id を埋めた作品を同じ実行で拾えるよう
        // 後続に置く。
        await runCronJob(env, "genre_fetch", () =>
          resolvePendingWorkGenres(db, undefined, {
            malClientId: env.MAL_CLIENT_ID,
          }),
        );
      })(),
    );
  },
} satisfies ExportedHandler<AppBindings>);
