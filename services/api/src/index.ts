import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { parseAllowedOrigins, resolveAllowedOrigin } from "./cors";
import { createDb } from "./db/client";
import type { Env } from "./db/client";
import {
  enqueuePendingImageFallbackJobs,
  handleImageFallbackQueue,
  type ImageFallbackJob,
} from "./lib/annict/imageFallbackQueue";
import {
  buildSentryOptions,
  handleError,
  type ObservabilityBindings,
} from "./observability";
import { annict } from "./routes/annict";
import { favorites } from "./routes/favorites";
import { friends } from "./routes/friends";
import { importRoute } from "./routes/import";
import { avatar, me } from "./routes/me";
import { pass } from "./routes/pass";
import { tierLists } from "./routes/tier-lists";
import { user } from "./routes/user";
import { watchHistory } from "./routes/watch-history";
import { works } from "./routes/works";

type AppBindings = Env &
  ObservabilityBindings & {
    IMAGE_FALLBACK_QUEUE?: Queue<ImageFallbackJob>;
    // CORS で許可するオリジンのカンマ区切りリスト。
    // 完全一致（"https://app.example.com"）とワイルドカード（"*-app.example.workers.dev"）を扱う。
    // 詳細は ./cors を参照。未設定の場合は開発利便のため全オリジンを許可する。
    ALLOWED_ORIGINS?: string;
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
  .get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  })
  // アバター配信は認証不要のため /me（requireAuth）より先にマウントする。
  .route("/me", avatar)
  .route("/me", me)
  .route("/me/annict", annict)
  .route("/me/import", importRoute)
  .route("/me/watch-histories", watchHistory)
  .route("/works", works)
  .route("/me/favorites", favorites)
  .route("/me/friends", friends)
  .route("/me/pass", pass)
  .route("/me/tier-lists", tierLists)
  .route("/user", user);

export type AppType = typeof routes;

// withSentry が fetch / queue / scheduled の全ハンドラを instrument する。
// ハンドラの外に漏れた例外は SDK が自動で capture し、app.onError で
// 応答に変換した例外は handleError 側で明示的に capture する。
export default Sentry.withSentry((env) => buildSentryOptions(env), {
  fetch: routes.fetch,
  // satisfies の文脈型で env を AppBindings に揃えるため矢印関数で包む。
  // （直接参照すると handleImageFallbackQueue 側の env 型が
  // withSentry の env 推論に union として混ざる）
  queue: (batch, env) => handleImageFallbackQueue(batch, env),
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      enqueuePendingImageFallbackJobs(
        createDb(env.DB as D1Database),
        env.IMAGE_FALLBACK_QUEUE,
      ),
    );
  },
} satisfies ExportedHandler<AppBindings, ImageFallbackJob>);
