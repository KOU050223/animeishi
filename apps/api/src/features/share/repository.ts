import { desc, eq, or } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  users,
  annictWorks,
  annictCharacters,
  tierLists,
  characterTierLists,
  watchHistory,
} from "@/db/schema";
import {
  fetchTierListItems,
  type TierListItemWithWork,
} from "../tier-lists/repository";
import {
  fetchCharacterTierListItems,
  type CharacterTierListItemWithMeta,
} from "../character-tier-lists/repository";

/**
 * 共有リンク（/share/tier-lists/:token 等）経由の公開参照。
 * ユーザー束縛リポジトリと違いユーザー束縛を持たない。トークンを知っている
 * 人なら誰でも読めるのが仕様なので、ここでは shareToken による引き当て
 * だけを行う。書き込み系は用意しない（公開面は読み取り専用）。
 */

/**
 * URL が DB に保存済みの画像（annict_works の作品画像 / annict_characters の
 * キャラクター画像）として実在するか。画像プロキシ（GET /share/image-proxy）
 * の許可判定に使い、DB にある画像だけを中継対象に絞る。
 */
export async function isKnownImageUrl(
  db: DrizzleDb,
  url: string,
): Promise<boolean> {
  const workRows = await db
    .select({ id: annictWorks.annictWorkId })
    .from(annictWorks)
    .where(
      or(eq(annictWorks.imageUrl, url), eq(annictWorks.resolvedImageUrl, url)),
    )
    .limit(1);
  if (workRows.length > 0) return true;
  const characterRows = await db
    .select({ id: annictCharacters.annictCharacterId })
    .from(annictCharacters)
    .where(eq(annictCharacters.imageUrl, url))
    .limit(1);
  return characterRows.length > 0;
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

export type SharedCharacterTierList = {
  annictWorkId: number;
  /** 表の対象作品のタイトル（共有ページの見出し・OGP 用）。 */
  workTitle: string;
  title: string;
  tiersJson: string;
  ownerUsername: string;
  items: CharacterTierListItemWithMeta[];
};

/**
 * 共有トークンから公開用のキャラクター tier 表を引く。未共有・破棄済みなら
 * undefined。作品 tier 表と同じく、トークンを知っている人なら誰でも読める。
 */
export async function getSharedCharacterTierList(
  db: DrizzleDb,
  token: string,
): Promise<SharedCharacterTierList | undefined> {
  const rows = await db
    .select({
      id: characterTierLists.id,
      annictWorkId: characterTierLists.annictWorkId,
      title: characterTierLists.title,
      tiersJson: characterTierLists.tiersJson,
      ownerUsername: users.username,
      workTitle: annictWorks.title,
    })
    .from(characterTierLists)
    .innerJoin(users, eq(characterTierLists.userId, users.id))
    .innerJoin(
      annictWorks,
      eq(characterTierLists.annictWorkId, annictWorks.annictWorkId),
    )
    .where(eq(characterTierLists.shareToken, token));

  const list = rows[0];
  if (!list) return undefined;

  const items = await fetchCharacterTierListItems(db, list.id);
  return {
    annictWorkId: list.annictWorkId,
    workTitle: list.workTitle,
    title: list.title,
    tiersJson: list.tiersJson,
    ownerUsername: list.ownerUsername,
    items,
  };
}

export type SharedWatchHistoryEntry = {
  annictWorkId: number;
  title: string;
  seasonName: string | null;
  seasonYear: number | null;
  state: string;
  /** 履歴行の最終更新時刻。共有表の「最終更新日」列に使う。 */
  updatedAt: Date;
};

export type SharedWatchHistory = {
  ownerUsername: string;
  items: SharedWatchHistoryEntry[];
};

/**
 * 共有トークンから公開用の視聴履歴を引く。未共有・破棄済みなら undefined。
 * tier 表と同じくトークンを知っている人なら誰でも読める。
 * トークンは users.watch_history_share_token に載る。
 */
export async function getSharedWatchHistory(
  db: DrizzleDb,
  token: string,
): Promise<SharedWatchHistory | undefined> {
  // 先にトークンの持ち主を引く。履歴 0 件（JOIN で行が出ない）と
  // 「トークンが無効」を区別するため、履歴の取得とは分ける。
  const owner = await db.query.users.findFirst({
    where: eq(users.watchHistoryShareToken, token),
    columns: { id: true, username: true },
  });
  if (!owner) return undefined;

  const items = await db
    .select({
      annictWorkId: watchHistory.annictWorkId,
      title: annictWorks.title,
      seasonName: annictWorks.seasonName,
      seasonYear: annictWorks.seasonYear,
      state: watchHistory.state,
      updatedAt: watchHistory.updatedAt,
    })
    .from(watchHistory)
    .innerJoin(
      annictWorks,
      eq(watchHistory.annictWorkId, annictWorks.annictWorkId),
    )
    .where(eq(watchHistory.userId, owner.id))
    .orderBy(desc(watchHistory.updatedAt));

  return { ownerUsername: owner.username, items };
}
