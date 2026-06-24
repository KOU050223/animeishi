import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./db/client";
import { favorites } from "./routes/favorites";
import { friends } from "./routes/friends";
import { avatar, me } from "./routes/me";
import { titles } from "./routes/titles";
import { user } from "./routes/user";
import { watchHistory } from "./routes/watch-history";

type AppBindings = Env & {
  // CORS で許可するオリジンのカンマ区切りリスト（例: "https://app.example.com,https://example.com"）。
  // 未設定の場合は開発利便のため全オリジンを許可する。
  ALLOWED_ORIGINS?: string;
};

const app = new Hono<{ Bindings: AppBindings }>();

app.use("*", (c, next) => {
  const allowlist = (c.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  return cors({
    // allowlist 未設定なら全許可（開発用）。設定済みなら一致するオリジンのみ反映する。
    origin: (origin) =>
      allowlist.length === 0 || allowlist.includes(origin) ? origin : null,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
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
  .route("/titles", titles)
  .route("/user", user);

export type AppType = typeof routes;
export default routes;
