import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { parseAllowedOrigins, resolveAllowedOrigin } from "#src/cors";
import { securityHeaders } from "#src/securityHeaders";
import type { Env } from "#src/db/client";
import { registerOpenApiDocs } from "#src/lib/openapi";
import { handleError, type ObservabilityBindings } from "#src/observability";
import { achievements } from "#src/features/achievements/index";
import { analysis } from "#src/features/analysis/index";
import { annict } from "#src/features/annict/index";
import { articles } from "#src/features/articles/index";
import { characterTierLists } from "#src/features/character-tier-lists/index";
import { common } from "#src/features/common/index";
import { customTierLists } from "#src/features/custom-tier-lists/index";
import { elections } from "#src/features/elections/index";
import {
  episodeRecords,
  workEpisodes,
} from "#src/features/episode-records/index";
import { events } from "#src/features/events/index";
import { workRatings } from "#src/features/work-ratings/index";
import { favorites } from "#src/features/favorites/index";
import { feed } from "#src/features/feed/index";
import { exchangeRecords } from "#src/features/exchange-records/index";
import { friendRequests } from "#src/features/friend-requests/index";
import { friendThanks } from "#src/features/friend-thanks/index";
import { friends } from "#src/features/friends/index";
import { socialLinks } from "#src/features/social-links/index";
import { health } from "#src/features/health/index";
import { images } from "#src/features/images/index";
import { importRoute } from "#src/features/import/index";
import { avatar, me, meishiAssets } from "#src/features/me/index";
import { pass } from "#src/features/pass/index";
import { publicTierListsRoute } from "#src/features/public-tier-lists/index";
import { share } from "#src/features/share/index";
import { tierLists } from "#src/features/tier-lists/index";
import { user } from "#src/features/user/index";
import { usersRoute } from "#src/features/users/index";
import { demoSignIn } from "#src/features/demo-sign-in/index";
import { feedbackRoute } from "#src/features/feedback/index";
import { publicUsersRoute } from "#src/features/users/public";
import { watchHistory } from "#src/features/watch-history/index";
import { workListsRoute } from "#src/features/work-lists/index";
import { publicWorkListsRoute } from "#src/features/work-lists/public";
import { works } from "#src/features/works/index";

export type AppBindings = Env &
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

// CORS のプリフライト応答（cors が next を呼ばずに返す）にも付くよう cors より先に置く。
app.use("*", securityHeaders());

app.use("*", (c, next) => {
  const allowlist = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);

  return cors({
    origin: (origin) => resolveAllowedOrigin(origin, allowlist),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
  // アバター配信・作品画像配信・共有リンク・デモアカウントのサインインは認証不要のため
  // /me（requireAuth）より先にマウントする。
  .route("/share", share)
  .route("/images", images)
  .route("/auth", demoSignIn)
  .route("/me", avatar)
  .route("/me", meishiAssets)
  .route("/me", me)
  .route("/me/annict", annict)
  .route("/me/import", importRoute)
  .route("/me/watch-histories", watchHistory)
  .route("/me/episode-records", episodeRecords)
  .route("/me/achievements", achievements)
  .route("/me/work-ratings", workRatings)
  .route("/me/analysis", analysis)
  .route("/works", works)
  .route("/works", workEpisodes)
  .route("/me/favorites", favorites)
  .route("/me/friends", friends)
  .route("/me/exchange-records", exchangeRecords)
  .route("/me/social-links", socialLinks)
  .route("/me/friend-requests", friendRequests)
  .route("/me/friend-thanks", friendThanks)
  .route("/me/feed", feed)
  .route("/articles", articles)
  .route("/events", events)
  .route("/elections", elections)
  .route("/me/pass", pass)
  .route("/me/tier-lists", tierLists)
  .route("/me/character-tier-lists", characterTierLists)
  .route("/me/custom-tier-lists", customTierLists)
  .route("/me/work-lists", workListsRoute)
  .route("/work-lists", publicWorkListsRoute)
  .route("/tier-lists", publicTierListsRoute)
  .route("/user", user)
  .route("/users", usersRoute)
  .route("/users", common)
  .route("/users", publicUsersRoute)
  .route("/feedback", feedbackRoute);

// OpenAPI ドキュメント（/doc）と Swagger UI（/ui）。OpenAPI 対応済み feature
// のルートのみ掲載される。本番を含む全環境で公開する（issue #14）。
// Hono RPC の型（AppType）には含めないため createRoute は使わず
// 素の app.get で登録する。
registerOpenApiDocs(app);

export type AppType = typeof routes;
export { routes };
