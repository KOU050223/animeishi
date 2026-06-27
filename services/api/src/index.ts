import { Hono } from "hono";
import { cors } from "hono/cors";
import { parseAllowedOrigins, resolveAllowedOrigin } from "./cors";
import type { Env } from "./db/client";
import { favorites } from "./routes/favorites";
import { friends } from "./routes/friends";
import { avatar, me } from "./routes/me";
import { user } from "./routes/user";
import { watchHistory } from "./routes/watch-history";

type AppBindings = Env & {
  // CORS で許可するオリジンのカンマ区切りリスト。
  // 完全一致（"https://app.example.com"）とワイルドカード（"*-app.example.workers.dev"）を扱う。
  // 詳細は ./cors を参照。未設定の場合は開発利便のため全オリジンを許可する。
  ALLOWED_ORIGINS?: string;
};

const app = new Hono<{ Bindings: AppBindings }>();

app.use("*", (c, next) => {
  const allowlist = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);

  return cors({
    origin: (origin) => resolveAllowedOrigin(origin, allowlist),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Annict-Token"],
  })(c, next);
});

const routes = app
  .get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  })
  // アバター配信は認証不要のため /me（requireAuth）より先にマウントする。
  .route("/me", avatar)
  .route("/me", me)
  .route("/me/watch-histories", watchHistory)
  .route("/me/favorites", favorites)
  .route("/me/friends", friends)
  .route("/user", user);

export type AppType = typeof routes;

export default {
  fetch: routes.fetch,
} satisfies ExportedHandler<AppBindings>;
