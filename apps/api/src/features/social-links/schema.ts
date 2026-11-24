import { createRoute, z } from "@hono/zod-openapi";
import { bearerAuth, errorResponseSchema } from "@/lib/openapi";

export const socialLinkKinds = [
  "x",
  "pixiv",
  "fanbox",
  "dlsite",
  "dmm",
  "youtube",
  "other",
] as const;
export const socialLinkVisibilities = ["public", "friends", "private"] as const;

type SocialLinkKind = (typeof socialLinkKinds)[number];

// 種別ごとの ID 形式。既知のサービスは ID（ユーザー名等）を受け取り
// URL をサーバー側で組み立てるため、ホスト部に使える文字だけを許す。
// YouTube のハンドルはピリオド・ハイフン・アンダースコアを含みうる
// （例: @anime.channel）ため、種別ごとに分けている。
const ID_PATTERNS: Record<Exclude<SocialLinkKind, "other">, RegExp> = {
  x: /^[A-Za-z0-9_]+$/,
  pixiv: /^[0-9]+$/,
  fanbox: /^[A-Za-z0-9-]+$/,
  dlsite: /^[A-Za-z0-9]+$/,
  dmm: /^[0-9]+$/,
  youtube: /^[A-Za-z0-9_.-]+$/,
};

const socialLinkInputSchema = z
  .object({
    kind: z.enum(socialLinkKinds),
    value: z.string().trim().min(1).max(200),
    visibility: z.enum(socialLinkVisibilities).default("friends"),
  })
  .superRefine((link, ctx) => {
    if (link.kind === "other") {
      try {
        const url = new URL(link.value);
        if (
          url.protocol === "https:" &&
          url.hostname &&
          !url.username &&
          !url.password
        )
          return;
      } catch {
        /* invalid URL */
      }
    } else if (ID_PATTERNS[link.kind].test(link.value)) {
      return;
    }
    ctx.addIssue({ code: "custom", message: "Invalid social link value" });
  });

const updateSocialLinksSchema = z.object({
  items: z.array(socialLinkInputSchema).max(20),
});

export type SocialLinkInput = z.infer<typeof socialLinkInputSchema>;

// 応答の 1 件。url は種別と ID からサーバー側で組み立てた遷移先。
const socialLinkSchema = z.object({
  kind: z.enum(socialLinkKinds),
  value: z.string(),
  visibility: z.enum(socialLinkVisibilities),
  url: z.string(),
});

const socialLinksResponse = {
  content: {
    "application/json": {
      schema: z.object({ items: z.array(socialLinkSchema) }),
    },
  },
};

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const getSocialLinksRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["social-links"],
  summary: "自分の SNS リンク一覧を取得する（全公開範囲）",
  security: bearerAuth,
  responses: {
    200: { ...socialLinksResponse, description: "表示順の SNS リンク" },
    401: jsonError("未認証"),
  },
});

export const updateSocialLinksRoute = createRoute({
  method: "put",
  path: "/",
  tags: ["social-links"],
  summary: "自分の SNS リンクを丸ごと置き換える（配列の順が表示順）",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: updateSocialLinksSchema } },
      required: true,
    },
  },
  responses: {
    200: { ...socialLinksResponse, description: "置き換え後の SNS リンク" },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});
