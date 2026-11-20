import { z } from "zod";

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

export const socialLinkInputSchema = z
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
    } else if (/^[a-zA-Z0-9_-]+$/.test(link.value)) {
      return;
    }
    ctx.addIssue({ code: "custom", message: "Invalid social link value" });
  });

export const updateSocialLinksSchema = z.object({
  items: z.array(socialLinkInputSchema).max(20),
});

export type SocialLinkInput = z.infer<typeof socialLinkInputSchema>;
