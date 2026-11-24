import { createRoute, z } from "@hono/zod-openapi";
import { errorResponseSchema } from "@/lib/openapi";
import {
  socialLinkKinds,
  socialLinkVisibilities,
} from "../social-links/schema";

const watchSummarySchema = z.object({
  watchedCount: z.number(),
  watchingCount: z.number(),
  wannaWatchCount: z.number(),
  favoriteCount: z.number(),
  favoriteTitles: z.array(z.string()),
  syncedAt: z.string().nullable(),
});

const nowWatchingSchema = z.object({
  annictWorkId: z.number(),
  annictEpisodeId: z.number(),
  title: z.string(),
  titleEn: z.string().nullable(),
  seasonName: z.string().nullable(),
  seasonYear: z.number().nullable(),
  hostedImageUrl: z.string().nullable(),
  recordedAt: z.string(),
});

// 公開名刺（JSON）。socialLinks は閲覧者との関係で見せてよい公開範囲だけ。
const publicUserCardSchema = z.object({
  id: z.string(),
  username: z.string(),
  bio: z.string().nullable(),
  favoriteQuote: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
  meishiSnapshotUrl: z.string().nullable(),
  genres: z.array(z.string()),
  socialLinks: z.array(
    z.object({
      kind: z.enum(socialLinkKinds),
      value: z.string(),
      visibility: z.enum(socialLinkVisibilities),
      url: z.string(),
    }),
  ),
  watchSummary: watchSummarySchema,
  nowWatching: nowWatchingSchema.nullable(),
});

const htmlPage = z.string().openapi({ format: "html" });

// Accept: text/html なら OGP 付きの共有用 HTML、それ以外は JSON を返す。
export const getPublicUserRoute = createRoute({
  method: "get",
  path: "/{uid}",
  tags: ["user"],
  summary: "公開名刺を取得する（Accept で JSON / OGP HTML を出し分け）",
  description:
    "認証は任意。サインイン済みならブロック関係にある相手を 404 にする。",
  request: {
    params: z.object({
      uid: z.string().min(1).openapi({ example: "user_xxxxxxxxxxxx" }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: publicUserCardSchema },
        "text/html": { schema: htmlPage },
      },
      description: "公開名刺",
    },
    404: {
      content: {
        "application/json": { schema: errorResponseSchema },
        "text/html": { schema: htmlPage },
      },
      description: "存在しない・非公開・ブロック関係にある",
    },
  },
});
