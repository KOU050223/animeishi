import { eq, or } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { users, annictWorks, tierLists, tierListItems } from "@/db/schema";
import type { TierListItemWithWork } from "./authorizedDb";

/**
 * 共有リンク（/share/tier-lists/:token）経由の公開参照。
 * authorizedDb と違いユーザー束縛を持たない。トークンを知っている人なら
 * 誰でも読めるのが仕様なので、ここでは shareToken による引き当てだけを行う。
 * 書き込み系は用意しない（公開面は読み取り専用）。
 */

/** tier 表 1 件分の配置を作品メタ付きで取得する（position 昇順）。 */
export async function fetchTierListItems(
  db: DrizzleDb,
  tierListId: number,
): Promise<TierListItemWithWork[]> {
  return db
    .select({
      annictWorkId: tierListItems.annictWorkId,
      tierKey: tierListItems.tierKey,
      position: tierListItems.position,
      title: annictWorks.title,
      titleKana: annictWorks.titleKana,
      titleEn: annictWorks.titleEn,
      seasonName: annictWorks.seasonName,
      seasonYear: annictWorks.seasonYear,
      imageUrl: annictWorks.imageUrl,
      resolvedImageUrl: annictWorks.resolvedImageUrl,
      imageSource: annictWorks.imageSource,
    })
    .from(tierListItems)
    .innerJoin(
      annictWorks,
      eq(tierListItems.annictWorkId, annictWorks.annictWorkId),
    )
    .where(eq(tierListItems.tierListId, tierListId))
    .orderBy(tierListItems.position);
}

/**
 * URL が annict_works の作品画像（image_url / resolved_image_url）として
 * 実在するか。画像プロキシ（GET /share/image-proxy）の許可判定に使い、
 * DB にある作品画像だけを中継対象に絞る。
 */
export async function isKnownWorkImageUrl(
  db: DrizzleDb,
  url: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: annictWorks.annictWorkId })
    .from(annictWorks)
    .where(
      or(eq(annictWorks.imageUrl, url), eq(annictWorks.resolvedImageUrl, url)),
    )
    .limit(1);
  return rows.length > 0;
}

export type SharedTierList = {
  season: string;
  title: string;
  tiersJson: string;
  ownerUsername: string;
  items: TierListItemWithWork[];
};

/** 共有トークンから公開用の tier 表を引く。未共有・破棄済みなら undefined。 */
export async function getSharedTierList(
  db: DrizzleDb,
  token: string,
): Promise<SharedTierList | undefined> {
  const rows = await db
    .select({
      id: tierLists.id,
      season: tierLists.season,
      title: tierLists.title,
      tiersJson: tierLists.tiersJson,
      ownerUsername: users.username,
    })
    .from(tierLists)
    .innerJoin(users, eq(tierLists.userId, users.id))
    .where(eq(tierLists.shareToken, token));

  const list = rows[0];
  if (!list) return undefined;

  const items = await fetchTierListItems(db, list.id);
  return {
    season: list.season,
    title: list.title,
    tiersJson: list.tiersJson,
    ownerUsername: list.ownerUsername,
    items,
  };
}
