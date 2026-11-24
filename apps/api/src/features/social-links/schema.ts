import { z } from "zod";

const socialLinkKinds = [
  "x",
  "pixiv",
  "fanbox",
  "dlsite",
  "dmm",
  "youtube",
  "other",
] as const;
const socialLinkVisibilities = ["public", "friends", "private"] as const;

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

export const updateSocialLinksSchema = z.object({
  items: z.array(socialLinkInputSchema).max(20),
});

export type SocialLinkInput = z.infer<typeof socialLinkInputSchema>;
