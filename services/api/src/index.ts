import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { parseAllowedOrigins, resolveAllowedOrigin } from "./cors";
import { createDb } from "./db/client";
import type { Env } from "./db/client";
import { resolvePendingImageFallbacks } from "./lib/annict/imageFallbackPending";
import { prefetchWorkImages } from "./lib/annict/imagePrefetch";
import {
  buildSentryOptions,
  handleError,
  type ObservabilityBindings,
} from "./observability";
import { annict } from "./routes/annict";
import { favorites } from "./routes/favorites";
import { friends } from "./routes/friends";
import { health } from "./routes/health";
import { images } from "./routes/images";
import { importRoute } from "./routes/import";
import { avatar, me, meishiAssets } from "./routes/me";
import { pass } from "./routes/pass";
import { share } from "./routes/share";
import { tierLists } from "./routes/tier-lists";
import { user } from "./routes/user";
import { usersRoute } from "./routes/users";
import { watchHistory } from "./routes/watch-history";
import { works } from "./routes/works";

type AppBindings = Env &
  ObservabilityBindings & {
    // CORS で許可するオリジンのカンマ区切りリスト。
    // 完全一致（"https://app.example.com"）とワイルドカード（"*-app.example.workers.dev"）を扱う。
    // 詳細は ./cors を参照。未設定の場合は開発利便のため全オリジンを許可する。
    ALLOWED_ORIGINS?: string;
    // デプロイ CI が --var で注入するデプロイ元コミット SHA。/health が返す。
    COMMIT_SHA?: string;
    // アバター＋作品画像（works/ プレフィックス）共通の R2 バケット。
    // wrangler.toml で全環境にバインド済み。
    AVATARS: R2Bucket;
  };

const app = new Hono<{ Bindings: AppBindings }>();

// 受信済みの X-Request-Id を引き継ぎ、無ければ UUID を採番して
// レスポンスヘッダに載せる。c.get("requestId") で参照できる。
app.use("*", requestId());

app.use("*", (c, next) => {
  const allowlist = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);

  return cors({
    origin: (origin) => resolveAllowedOrigin(origin, allowlist),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "X-Annict-Token",
      "X-Request-Id",
    ],
    // ブラウザから採番された requestId を読めるよう公開する。
    exposeHeaders: ["X-Request-Id"],
  })(c, next);
});

// 未処理例外の分類・Sentry 送信・応答整形は observability 側に集約している。
app.onError(handleError);

const routes = app
  .route("/health", health)
  // アバター配信・作品画像配信・共有リンクは認証不要のため
  // /me（requireAuth）より先にマウントする。
  .route("/share", share)
  .route("/images", images)
  .route("/me", avatar)
  .route("/me", meishiAssets)
  .route("/me", me)
  .route("/me/annict", annict)
  .route("/me/import", importRoute)
  .route("/me/watch-histories", watchHistory)
  .route("/works", works)
  .route("/me/favorites", favorites)
  .route("/me/friends", friends)
  .route("/me/pass", pass)
  .route("/me/tier-lists", tierLists)
  .route("/user", user)
  .route("/users", usersRoute);

export type AppType = typeof routes;

// withSentry が fetch / scheduled の全ハンドラを instrument する。
// ハンドラの外に漏れた例外は SDK が自動で capture し、app.onError で
// 応答に変換した例外は handleError 側で明示的に capture する。
export default Sentry.withSentry((env) => buildSentryOptions(env), {
  fetch: routes.fetch,
  // 画像フォールバックは Queue を介さず、cron が D1 の未解決行を
  // 直接回して解決する（issue #127）。続けて、解決済みを含む今期・来期作品の
  // 画像を R2 へ取り込み（issue #174）、GET /images/... で自前配信できるようにする。
  // 片方の失敗でもう片方が巻き込まれないよう個別に握る。
  scheduled(_controller, env, ctx) {
    const db = createDb(env.DB as D1Database);
    ctx.waitUntil(
      (async () => {
        try {
          await resolvePendingImageFallbacks(db);
        } catch (err) {
          console.error(
            JSON.stringify({
              level: "error",
              event: "image_fallback_cron_failed",
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
        try {
          await prefetchWorkImages(db, env.AVATARS);
        } catch (err) {
          console.error(
            JSON.stringify({
              level: "error",
              event: "work_image_prefetch_cron_failed",
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      })(),
    );
  },
} satisfies ExportedHandler<AppBindings>);
