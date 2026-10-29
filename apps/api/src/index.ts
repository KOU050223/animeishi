import * as Sentry from "@sentry/cloudflare";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { parseAllowedOrigins, resolveAllowedOrigin } from "./cors";
import { createDb } from "./db/client";
import type { Env } from "./db/client";
import { registerOpenApiDocs } from "./lib/openapi";
import { resolvePendingImageFallbacks } from "./lib/annict/imageFallbackPending";
import { resolveMissingMalIds } from "./lib/annict/kitsuTitleSearch";
import {
  buildSentryOptions,
  handleError,
  runCronJob,
  type ObservabilityBindings,
} from "./observability";
import { analysis } from "./features/analysis";
import { annict } from "./features/annict";
import { characterTierLists } from "./features/character-tier-lists";
import { customTierLists } from "./features/custom-tier-lists";
import { favorites } from "./features/favorites";
import { feed } from "./features/feed";
import { friends } from "./features/friends";
import { health } from "./features/health";
import { images } from "./features/images";
import { importRoute } from "./features/import";
import { avatar, me, meishiAssets } from "./features/me";
import { pass } from "./features/pass";
import { share } from "./features/share";
import { tierLists } from "./features/tier-lists";
import { user } from "./features/user";
import { usersRoute } from "./features/users";
import { watchHistory } from "./features/watch-history";
import { works } from "./features/works";

type AppBindings = Env &
  ObservabilityBindings & {
    // CORS で許可するオリジンのカンマ区切りリスト。
    // 完全一致（"https://app.example.com"）とワイルドカード（"*-app.example.workers.dev"）を扱う。
    // 詳細は ./cors を参照。未設定の場合は開発利便のため全オリジンを許可する。
    ALLOWED_ORIGINS?: string;
    // デプロイ CI が --var で注入するデプロイ元コミット SHA。/health が返す。
    COMMIT_SHA?: string;
    // wrangler.toml の [vars]。production / preview / 未設定（ローカル）。
    // features/health の応答と Sentry の environment 判定に使う。
    ENVIRONMENT?: string;
    // アバター＋作品画像（works/ プレフィックス）共通の R2 バケット。
    // wrangler.toml で全環境にバインド済み。
    AVATARS: R2Bucket;
    // Workers AI（視聴傾向分析 POST /me/analysis, issue #22）。
    AI: Ai;
    // MAL API の Client ID（Workers Secret）。作品画像を Kitsu で補えない
    // ときに MAL API から引く（issue #238）。未設定なら MAL は使わない。
    MAL_CLIENT_ID?: string;
  };

const app = new OpenAPIHono<{ Bindings: AppBindings }>();

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
  .route("/me/analysis", analysis)
  .route("/works", works)
  .route("/me/favorites", favorites)
  .route("/me/friends", friends)
  .route("/me/feed", feed)
  .route("/me/pass", pass)
  .route("/me/tier-lists", tierLists)
  .route("/me/character-tier-lists", characterTierLists)
  .route("/me/custom-tier-lists", customTierLists)
  .route("/user", user)
  .route("/users", usersRoute);

// OpenAPI ドキュメント（/doc）と Swagger UI（/ui）。OpenAPI 対応済み feature
// のルートのみ掲載される。本番を含む全環境で公開する（issue #14）。
// Hono RPC の型（AppType）には含めないため createRoute は使わず
// 素の app.get で登録する。
registerOpenApiDocs(app);

export type AppType = typeof routes;

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
      })(),
    );
  },
} satisfies ExportedHandler<AppBindings>);
