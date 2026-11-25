import { and, asc, eq, inArray } from "drizzle-orm";
import type { DrizzleDb } from "#src/db/client";
import { friends, socialLinks } from "#src/db/schema";
import type { SocialLinkInput } from "./schema";

export function socialLinksRepository(db: DrizzleDb) {
  async function list(userId: string, viewerId?: string) {
    const relation =
      viewerId === userId
        ? "self"
        : viewerId &&
            (
              await db
                .select({ id: friends.id })
                .from(friends)
                .where(
                  and(
                    eq(friends.userId, viewerId),
                    eq(friends.friendId, userId),
                  ),
                )
                .limit(1)
            ).length
          ? "friend"
          : "other";
    const allowed =
      relation === "self"
        ? (["public", "friends", "private"] as const)
        : relation === "friend"
          ? (["public", "friends"] as const)
          : (["public"] as const);
    const rows = await db
      .select({
        kind: socialLinks.kind,
        value: socialLinks.value,
        visibility: socialLinks.visibility,
      })
      .from(socialLinks)
      .where(
        and(
          eq(socialLinks.userId, userId),
          inArray(socialLinks.visibility, [...allowed]),
        ),
      )
      .orderBy(asc(socialLinks.position));
    return rows.map((row) => ({
      ...row,
      url: socialLinkUrl(row.kind, row.value),
    }));
  }

  async function replace(userId: string, items: SocialLinkInput[]) {
    const deletion = db
      .delete(socialLinks)
      .where(eq(socialLinks.userId, userId));
    if (items.length === 0) await deletion;
    else
      await db.batch([
        deletion,
        db
          .insert(socialLinks)
          .values(
            items.map((item, position) => ({ ...item, userId, position })),
          ),
      ]);
    return list(userId, userId);
  }

  return { list, replace };
}

function socialLinkUrl(kind: string, value: string): string {
  const id = encodeURIComponent(value);
  switch (kind) {
    case "x":
      return `https://x.com/${id}`;
    case "pixiv":
      return `https://www.pixiv.net/users/${id}`;
    case "fanbox":
      return `https://${id}.fanbox.cc`;
    case "dlsite":
      return `https://www.dlsite.com/home/circle/profile/=/maker_id/${id}.html`;
    case "dmm":
      return `https://www.dmm.co.jp/dc/doujin/-/list/=/article=maker/id=${id}/`;
    case "youtube":
      return `https://www.youtube.com/@${id}`;
    default:
      return value;
  }
}
