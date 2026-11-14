import { and, desc, eq, inArray, notExists, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  users,
  blocks,
  tierLists,
  tierListItems,
  characterTierLists,
  characterTierListItems,
  customTierLists,
  customTierListItems,
  tierListLikes,
  annictWorks,
  annictCharacters,
} from "@/db/schema";
import type { TierListKind } from "@/db/schema";
import type { TierRow } from "../share/service";
import { parseTiersJson } from "../share/service";
import { fetchTierListItems } from "../tier-lists/repository";
import { fetchCharacterTierListItems } from "../character-tier-lists/repository";
import { fetchCustomTierListItems } from "../custom-tier-lists/repository";

export type PublicTierListsSort = "likes" | "new";

/**
 * 結合フィードの降順ソートのタイブレークに使う種別順位（cursor にも入る）。
 * 一意な総順序が必要なだけで、種別間に意図した優先度はない。
 */
const KIND_RANK: Record<TierListKind, number> = {
  season: 0,
  character: 1,
  custom: 2,
};

export function tierListKindRank(kind: TierListKind): number {
  return KIND_RANK[kind];
}

/** 一覧の行。レスポンスの owner / likeCount / thumbnails のもとになる。 */
export type PublicTierListRow = {
  kind: TierListKind;
  id: number;
  title: string;
  description: string | null;
  /** サムネイル決定（先頭 tier の抽出）に使う。 */
  tiersJson: string;
  createdAt: Date;
  /** season 種別のみ。対象シーズン（"2026-spring" 等）。 */
  season: string | null;
  /** character 種別のみ。対象作品。 */
  annictWorkId: number | null;
  workTitle: string | null;
  ownerUserId: string;
  ownerUsername: string;
  ownerProfileImageUrl: string | null;
  itemCount: number;
  likeCount: number;
  likedByMe: boolean;
};

/** 詳細レスポンスの items 要素。kind で中身が変わる。 */
export type PublicTierListItem =
  | {
      kind: "work";
      annictWorkId: number;
      tierKey: string;
      position: number;
      title: string;
    }
  | {
      kind: "character";
      annictCharacterId: number;
      tierKey: string;
      position: number;
      name: string;
      imageUrl: string | null;
    };

export type PublicTierListDetail = Omit<PublicTierListRow, "tiersJson"> & {
  tiers: TierRow[];
  items: PublicTierListItem[];
};

/** 自分の tier 表にいいねしようとしたときのエラー。ルート層で 400 に変換する。 */
export class OwnTierListError extends Error {
  constructor() {
    super("自分の tier 表にいいねはできません");
  }
}

// 公開作品リスト（work-lists/repository.ts）と同じ可視条件。
// リスト側・オーナー側の両方に公開フラグを持たせ、非公開プロフィール
// （users.is_public = false）のリストを発見面から外す。
// ブロック関係はどちら側からでも除外する。いいね・通報・詳細でも同じ
// 条件を使い、公開範囲外のリストは存在自体を隠す（404）。
function visibilityCondition(
  db: DrizzleDb,
  currentUserId: string,
  listTable:
    | typeof tierLists
    | typeof characterTierLists
    | typeof customTierLists,
) {
  return and(
    eq(listTable.isPublic, true),
    eq(users.isPublic, true),
    notExists(
      db
        .select({ one: sql`1` })
        .from(blocks)
        .where(
          or(
            and(
              eq(blocks.blockerId, currentUserId),
              eq(blocks.blockedId, listTable.userId),
            ),
            and(
              eq(blocks.blockerId, listTable.userId),
              eq(blocks.blockedId, currentUserId),
            ),
          ),
        ),
    ),
  );
}

// tier_list_likes は list_id 側に FK を張れない（kind で参照先テーブルが
// 変わる）ため、対象は必ず (list_kind, list_id) のペアで絞る。
function likeCountExpr(
  kind: TierListKind,
  listIdCol:
    | typeof tierLists.id
    | typeof characterTierLists.id
    | typeof customTierLists.id,
) {
  return sql<number>`(
    SELECT COUNT(*) FROM ${tierListLikes}
    WHERE ${tierListLikes.listKind} = ${kind}
      AND ${tierListLikes.listId} = ${listIdCol}
  )`;
}

function likedByMeExpr(
  currentUserId: string,
  kind: TierListKind,
  listIdCol:
    | typeof tierLists.id
    | typeof characterTierLists.id
    | typeof customTierLists.id,
) {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM ${tierListLikes}
    WHERE ${tierListLikes.userId} = ${currentUserId}
      AND ${tierListLikes.listKind} = ${kind}
      AND ${tierListLikes.listId} = ${listIdCol}
  )`;
}

/** cursor は "<ソートキー>_<kind 順位>_<id>"。 */
type ParsedCursor = { sortKey: number; rank: number; id: number };

export function parsePublicTierListCursor(
  cursor: string,
): ParsedCursor | undefined {
  const m = /^(\d+)_(\d+)_(\d+)$/.exec(cursor);
  if (!m) return undefined;
  return {
    sortKey: Number(m[1]),
    rank: Number(m[2]),
    id: Number(m[3]),
  };
}

/**
 * kind ごとの cursor 条件。結合フィードは (ソートキー, kind 順位, id) の
 * 降順で並ぶため、「cursor より後ろの行」の条件はこの kind の順位
 * によって変わる。
 * - 順位が cursor より前: 同ソートキーでも cursor より後ろなので <=
 * - 同順位: ソートキーが小さいか、同ソートキーで id が小さい
 * - 順位が後: ソートキーが小さい行だけ
 */
function cursorCondition(
  sortExpr: SQL,
  idCol:
    | typeof tierLists.id
    | typeof characterTierLists.id
    | typeof customTierLists.id,
  rank: number,
  cursor: ParsedCursor,
): SQL {
  if (rank < cursor.rank) {
    return sql`${sortExpr} <= ${cursor.sortKey}`;
  }
  if (rank === cursor.rank) {
    return sql`(
      ${sortExpr} < ${cursor.sortKey}
      OR (${sortExpr} = ${cursor.sortKey} AND ${idCol} < ${cursor.id})
    )`;
  }
  return sql`${sortExpr} < ${cursor.sortKey}`;
}

function sortKeyOf(sort: PublicTierListsSort, row: PublicTierListRow): number {
  // created_at は unix 秒で保存される（drizzle timestamp mode）ため、
  // SQL 側の比較と同じ秒単位に丸めてから結合順を決める。
  return sort === "likes"
    ? row.likeCount
    : Math.floor(row.createdAt.getTime() / 1000);
}

/** 一覧カードのサムネイル。先頭 tier の先頭アイテムから最大 3 個。 */
const THUMB_COUNT = 3;

// title / name は画像が取れないときの代替表示に使う（issue #522）。
export type PublicTierListThumb =
  | { kind: "work"; annictWorkId: number; title: string }
  | { kind: "character"; imageUrl: string | null; name: string };

export function publicTierListsRepository(
  db: DrizzleDb,
  currentUserId: string,
) {
  async function fetchSeasonRows(
    sort: PublicTierListsSort,
    cursor: ParsedCursor | undefined,
    limit: number,
  ): Promise<PublicTierListRow[]> {
    const likeExpr = likeCountExpr("season", tierLists.id);
    const sortExpr = sort === "likes" ? likeExpr : sql`${tierLists.createdAt}`;
    const rows = await db
      .select({
        id: tierLists.id,
        title: tierLists.title,
        description: tierLists.description,
        tiersJson: tierLists.tiersJson,
        createdAt: tierLists.createdAt,
        season: tierLists.season,
        ownerUserId: users.id,
        ownerUsername: users.username,
        ownerProfileImageUrl: users.profileImageUrl,
        itemCount: sql<number>`(
          SELECT COUNT(*) FROM ${tierListItems}
          WHERE ${tierListItems.tierListId} = ${tierLists.id}
        )`.as("item_count"),
        likeCount: sql<number>`${likeExpr}`.as("like_count"),
        likedByMe:
          sql<number>`${likedByMeExpr(currentUserId, "season", tierLists.id)}`.as(
            "liked_by_me",
          ),
      })
      .from(tierLists)
      .innerJoin(users, eq(tierLists.userId, users.id))
      .where(
        and(
          visibilityCondition(db, currentUserId, tierLists),
          cursor
            ? cursorCondition(sortExpr, tierLists.id, KIND_RANK.season, cursor)
            : undefined,
        ),
      )
      .orderBy(desc(sortExpr), desc(tierLists.id))
      .limit(limit + 1);
    return rows.map((r) => ({
      kind: "season" as const,
      annictWorkId: null,
      workTitle: null,
      ...r,
      likedByMe: r.likedByMe === 1,
    }));
  }

  async function fetchCharacterRows(
    sort: PublicTierListsSort,
    cursor: ParsedCursor | undefined,
    limit: number,
  ): Promise<PublicTierListRow[]> {
    const likeExpr = likeCountExpr("character", characterTierLists.id);
    const sortExpr =
      sort === "likes" ? likeExpr : sql`${characterTierLists.createdAt}`;
    const rows = await db
      .select({
        id: characterTierLists.id,
        title: characterTierLists.title,
        description: characterTierLists.description,
        tiersJson: characterTierLists.tiersJson,
        createdAt: characterTierLists.createdAt,
        annictWorkId: characterTierLists.annictWorkId,
        workTitle: annictWorks.title,
        ownerUserId: users.id,
        ownerUsername: users.username,
        ownerProfileImageUrl: users.profileImageUrl,
        itemCount: sql<number>`(
          SELECT COUNT(*) FROM ${characterTierListItems}
          WHERE ${characterTierListItems.characterTierListId} = ${characterTierLists.id}
        )`.as("item_count"),
        likeCount: sql<number>`${likeExpr}`.as("like_count"),
        likedByMe:
          sql<number>`${likedByMeExpr(currentUserId, "character", characterTierLists.id)}`.as(
            "liked_by_me",
          ),
      })
      .from(characterTierLists)
      .innerJoin(users, eq(characterTierLists.userId, users.id))
      .innerJoin(
        annictWorks,
        eq(characterTierLists.annictWorkId, annictWorks.annictWorkId),
      )
      .where(
        and(
          visibilityCondition(db, currentUserId, characterTierLists),
          cursor
            ? cursorCondition(
                sortExpr,
                characterTierLists.id,
                KIND_RANK.character,
                cursor,
              )
            : undefined,
        ),
      )
      .orderBy(desc(sortExpr), desc(characterTierLists.id))
      .limit(limit + 1);
    return rows.map((r) => ({
      kind: "character" as const,
      season: null,
      ...r,
      likedByMe: r.likedByMe === 1,
    }));
  }

  async function fetchCustomRows(
    sort: PublicTierListsSort,
    cursor: ParsedCursor | undefined,
    limit: number,
  ): Promise<PublicTierListRow[]> {
    const likeExpr = likeCountExpr("custom", customTierLists.id);
    const sortExpr =
      sort === "likes" ? likeExpr : sql`${customTierLists.createdAt}`;
    const rows = await db
      .select({
        id: customTierLists.id,
        title: customTierLists.title,
        description: customTierLists.description,
        tiersJson: customTierLists.tiersJson,
        createdAt: customTierLists.createdAt,
        ownerUserId: users.id,
        ownerUsername: users.username,
        ownerProfileImageUrl: users.profileImageUrl,
        itemCount: sql<number>`(
          SELECT COUNT(*) FROM ${customTierListItems}
          WHERE ${customTierListItems.customTierListId} = ${customTierLists.id}
        )`.as("item_count"),
        likeCount: sql<number>`${likeExpr}`.as("like_count"),
        likedByMe:
          sql<number>`${likedByMeExpr(currentUserId, "custom", customTierLists.id)}`.as(
            "liked_by_me",
          ),
      })
      .from(customTierLists)
      .innerJoin(users, eq(customTierLists.userId, users.id))
      .where(
        and(
          visibilityCondition(db, currentUserId, customTierLists),
          cursor
            ? cursorCondition(
                sortExpr,
                customTierLists.id,
                KIND_RANK.custom,
                cursor,
              )
            : undefined,
        ),
      )
      .orderBy(desc(sortExpr), desc(customTierLists.id))
      .limit(limit + 1);
    return rows.map((r) => ({
      kind: "custom" as const,
      season: null,
      annictWorkId: null,
      workTitle: null,
      ...r,
      likedByMe: r.likedByMe === 1,
    }));
  }

  /** 公開範囲チェック付きの単一行取得（いいね・通報の対象解決に使う）。 */
  async function findPublicRow(
    kind: TierListKind,
    id: number,
  ): Promise<{ id: number; userId: string; title: string } | null> {
    if (kind === "season") {
      const rows = await db
        .select({
          id: tierLists.id,
          userId: tierLists.userId,
          title: tierLists.title,
        })
        .from(tierLists)
        .innerJoin(users, eq(tierLists.userId, users.id))
        .where(
          and(
            eq(tierLists.id, id),
            visibilityCondition(db, currentUserId, tierLists),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    }
    if (kind === "character") {
      const rows = await db
        .select({
          id: characterTierLists.id,
          userId: characterTierLists.userId,
          title: characterTierLists.title,
        })
        .from(characterTierLists)
        .innerJoin(users, eq(characterTierLists.userId, users.id))
        .where(
          and(
            eq(characterTierLists.id, id),
            visibilityCondition(db, currentUserId, characterTierLists),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    }
    const rows = await db
      .select({
        id: customTierLists.id,
        userId: customTierLists.userId,
        title: customTierLists.title,
      })
      .from(customTierLists)
      .innerJoin(users, eq(customTierLists.userId, users.id))
      .where(
        and(
          eq(customTierLists.id, id),
          visibilityCondition(db, currentUserId, customTierLists),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    /**
     * 公開 Tier 表の一覧（issue #418）。3 種類は別テーブルのため SQL の
     * UNION ではなく kind ごとに絞ってから JS で結合する。各 kind には
     * 結合後の順序 (ソートキー, kind 順位, id) で cursor 条件を掛け、
     * limit+1 件ずつ取ったうえで全体で limit 件に切る
     * （余分の 1 件は hasMore 判定用）。
     */
    async getPublicTierLists(input: {
      sort: PublicTierListsSort;
      cursor?: string | undefined;
      limit: number;
    }): Promise<{ items: PublicTierListRow[]; hasMore: boolean }> {
      const cursor =
        input.cursor !== undefined
          ? parsePublicTierListCursor(input.cursor)
          : undefined;
      const [season, character, custom] = await Promise.all([
        fetchSeasonRows(input.sort, cursor, input.limit),
        fetchCharacterRows(input.sort, cursor, input.limit),
        fetchCustomRows(input.sort, cursor, input.limit),
      ]);
      const merged = [...season, ...character, ...custom];
      merged.sort((a, b) => {
        const av = sortKeyOf(input.sort, a);
        const bv = sortKeyOf(input.sort, b);
        if (av !== bv) return bv - av;
        const ar = KIND_RANK[a.kind];
        const br = KIND_RANK[b.kind];
        if (ar !== br) return br - ar;
        return b.id - a.id;
      });
      const items = merged.slice(0, input.limit);
      return { items, hasMore: merged.length > input.limit };
    },

    /**
     * 公開範囲内にあるかどうかの確認（いいね・通報の対象解決に使う）。
     * 非公開・非公開オーナー・ブロック関係は null を返し 404 にする
     * （公開作品リストと同じく、存在自体を隠す）。
     */
    async findPublicTierList(
      kind: TierListKind,
      id: number,
    ): Promise<{ id: number; userId: string; title: string } | null> {
      return findPublicRow(kind, id);
    },

    /**
     * 公開 Tier 表の詳細（閲覧専用）。公開範囲外は null。
     * items は各 kind の既存 fetcher を使い、共通の形に寄せて返す。
     */
    async getPublicTierList(
      kind: TierListKind,
      id: number,
    ): Promise<PublicTierListDetail | null> {
      const head = await fetchPublicHead(kind, id);
      if (!head) return null;

      const items: PublicTierListItem[] =
        kind === "season"
          ? (await fetchTierListItems(db, id)).map((i) => ({
              kind: "work" as const,
              annictWorkId: i.annictWorkId,
              tierKey: i.tierKey,
              position: i.position,
              title: i.title,
            }))
          : kind === "character"
            ? (await fetchCharacterTierListItems(db, id)).map((i) => ({
                kind: "character" as const,
                annictCharacterId: i.annictCharacterId,
                tierKey: i.tierKey,
                position: i.position,
                name: i.name,
                imageUrl: i.imageUrl,
              }))
            : (await fetchCustomTierListItems(db, id)).map((i) => ({
                kind: "work" as const,
                annictWorkId: i.annictWorkId,
                tierKey: i.tierKey,
                position: i.position,
                title: i.title,
              }));

      return { ...head, tiers: parseTiersJson(head.tiersJson), items };

      async function fetchPublicHead(
        k: TierListKind,
        listId: number,
      ): Promise<PublicTierListRow | null> {
        const [season, character, custom] = await Promise.all([
          k === "season" ? fetchSeasonHead(listId) : Promise.resolve(null),
          k === "character"
            ? fetchCharacterHead(listId)
            : Promise.resolve(null),
          k === "custom" ? fetchCustomHead(listId) : Promise.resolve(null),
        ]);
        return season ?? character ?? custom;
      }

      async function fetchSeasonHead(listId: number) {
        const likeExpr = likeCountExpr("season", tierLists.id);
        const rows = await db
          .select({
            id: tierLists.id,
            title: tierLists.title,
            description: tierLists.description,
            tiersJson: tierLists.tiersJson,
            createdAt: tierLists.createdAt,
            season: tierLists.season,
            ownerUserId: users.id,
            ownerUsername: users.username,
            ownerProfileImageUrl: users.profileImageUrl,
            itemCount: sql<number>`(
              SELECT COUNT(*) FROM ${tierListItems}
              WHERE ${tierListItems.tierListId} = ${tierLists.id}
            )`.as("item_count"),
            likeCount: sql<number>`${likeExpr}`.as("like_count"),
            likedByMe:
              sql<number>`${likedByMeExpr(currentUserId, "season", tierLists.id)}`.as(
                "liked_by_me",
              ),
          })
          .from(tierLists)
          .innerJoin(users, eq(tierLists.userId, users.id))
          .where(
            and(
              eq(tierLists.id, listId),
              visibilityCondition(db, currentUserId, tierLists),
            ),
          )
          .limit(1);
        const r = rows[0];
        return r
          ? {
              kind: "season" as const,
              annictWorkId: null,
              workTitle: null,
              ...r,
              likedByMe: r.likedByMe === 1,
            }
          : null;
      }

      async function fetchCharacterHead(listId: number) {
        const likeExpr = likeCountExpr("character", characterTierLists.id);
        const rows = await db
          .select({
            id: characterTierLists.id,
            title: characterTierLists.title,
            description: characterTierLists.description,
            tiersJson: characterTierLists.tiersJson,
            createdAt: characterTierLists.createdAt,
            annictWorkId: characterTierLists.annictWorkId,
            workTitle: annictWorks.title,
            ownerUserId: users.id,
            ownerUsername: users.username,
            ownerProfileImageUrl: users.profileImageUrl,
            itemCount: sql<number>`(
              SELECT COUNT(*) FROM ${characterTierListItems}
              WHERE ${characterTierListItems.characterTierListId} = ${characterTierLists.id}
            )`.as("item_count"),
            likeCount: sql<number>`${likeExpr}`.as("like_count"),
            likedByMe:
              sql<number>`${likedByMeExpr(currentUserId, "character", characterTierLists.id)}`.as(
                "liked_by_me",
              ),
          })
          .from(characterTierLists)
          .innerJoin(users, eq(characterTierLists.userId, users.id))
          .innerJoin(
            annictWorks,
            eq(characterTierLists.annictWorkId, annictWorks.annictWorkId),
          )
          .where(
            and(
              eq(characterTierLists.id, listId),
              visibilityCondition(db, currentUserId, characterTierLists),
            ),
          )
          .limit(1);
        const r = rows[0];
        return r
          ? {
              kind: "character" as const,
              season: null,
              ...r,
              likedByMe: r.likedByMe === 1,
            }
          : null;
      }

      async function fetchCustomHead(listId: number) {
        const likeExpr = likeCountExpr("custom", customTierLists.id);
        const rows = await db
          .select({
            id: customTierLists.id,
            title: customTierLists.title,
            description: customTierLists.description,
            tiersJson: customTierLists.tiersJson,
            createdAt: customTierLists.createdAt,
            ownerUserId: users.id,
            ownerUsername: users.username,
            ownerProfileImageUrl: users.profileImageUrl,
            itemCount: sql<number>`(
              SELECT COUNT(*) FROM ${customTierListItems}
              WHERE ${customTierListItems.customTierListId} = ${customTierLists.id}
            )`.as("item_count"),
            likeCount: sql<number>`${likeExpr}`.as("like_count"),
            likedByMe:
              sql<number>`${likedByMeExpr(currentUserId, "custom", customTierLists.id)}`.as(
                "liked_by_me",
              ),
          })
          .from(customTierLists)
          .innerJoin(users, eq(customTierLists.userId, users.id))
          .where(
            and(
              eq(customTierLists.id, listId),
              visibilityCondition(db, currentUserId, customTierLists),
            ),
          )
          .limit(1);
        const r = rows[0];
        return r
          ? {
              kind: "custom" as const,
              season: null,
              annictWorkId: null,
              workTitle: null,
              ...r,
              likedByMe: r.likedByMe === 1,
            }
          : null;
      }
    },

    /**
     * 公開 Tier 表へのいいね（冪等。すでにいいね済みでも成功）。
     * 公開範囲外（非公開・非公開オーナー・ブロック関係）は null（404）。
     * 自分のリストへのいいねは OwnTierListError（400）。
     */
    async likeTierList(
      kind: TierListKind,
      id: number,
    ): Promise<{ likeCount: number } | null> {
      const row = await findPublicRow(kind, id);
      if (!row) return null;
      if (row.userId === currentUserId) throw new OwnTierListError();
      await db
        .insert(tierListLikes)
        .values({
          userId: currentUserId,
          listKind: kind,
          listId: id,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
      return { likeCount: await this.countTierListLikes(kind, id) };
    },

    /**
     * 公開 Tier 表へのいいね解除（冪等。いいねしていなくても成功）。
     * 公開範囲外は null（閲覧できないリストの反応数を返さない）。
     */
    async unlikeTierList(
      kind: TierListKind,
      id: number,
    ): Promise<{ likeCount: number } | null> {
      const row = await findPublicRow(kind, id);
      if (!row) return null;
      await db
        .delete(tierListLikes)
        .where(
          and(
            eq(tierListLikes.userId, currentUserId),
            eq(tierListLikes.listKind, kind),
            eq(tierListLikes.listId, id),
          ),
        );
      return { likeCount: await this.countTierListLikes(kind, id) };
    },

    /** リストの現在のいいね数。いいね/いいね解除のレスポンス用。 */
    async countTierListLikes(kind: TierListKind, id: number): Promise<number> {
      const [row] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(tierListLikes)
        .where(
          and(eq(tierListLikes.listKind, kind), eq(tierListLikes.listId, id)),
        );
      return row?.c ?? 0;
    },

    /**
     * 一覧ページ分のサムネイルをまとめて返す。キーは "<kind>:<id>"。
     * 先頭 tier の先頭アイテムから最大 THUMB_COUNT 個
     * （公開作品リストの「先頭 3 件」と同じ見せ方）。
     */
    async fetchThumbnails(
      rows: PublicTierListRow[],
    ): Promise<Map<string, PublicTierListThumb[]>> {
      const result = new Map<string, PublicTierListThumb[]>();
      const idsOf = (k: TierListKind) =>
        rows.filter((r) => r.kind === k).map((r) => r.id);
      const seasonIds = idsOf("season");
      const characterIds = idsOf("character");
      const customIds = idsOf("custom");

      // kind ごとにページ内リストの items を一括取得（N+1 回避）。
      const [seasonItems, characterItems, customItems] = await Promise.all([
        seasonIds.length === 0
          ? Promise.resolve([])
          : db
              .select({
                listId: tierListItems.tierListId,
                workId: tierListItems.annictWorkId,
                tierKey: tierListItems.tierKey,
                position: tierListItems.position,
                title: annictWorks.title,
              })
              .from(tierListItems)
              .innerJoin(
                annictWorks,
                eq(tierListItems.annictWorkId, annictWorks.annictWorkId),
              )
              .where(inArray(tierListItems.tierListId, seasonIds)),
        characterIds.length === 0
          ? Promise.resolve([])
          : db
              .select({
                listId: characterTierListItems.characterTierListId,
                characterId: characterTierListItems.annictCharacterId,
                tierKey: characterTierListItems.tierKey,
                position: characterTierListItems.position,
                imageUrl: annictCharacters.imageUrl,
                name: annictCharacters.name,
              })
              .from(characterTierListItems)
              .innerJoin(
                annictCharacters,
                eq(
                  characterTierListItems.annictCharacterId,
                  annictCharacters.annictCharacterId,
                ),
              )
              .where(
                inArray(
                  characterTierListItems.characterTierListId,
                  characterIds,
                ),
              ),
        customIds.length === 0
          ? Promise.resolve([])
          : db
              .select({
                listId: customTierListItems.customTierListId,
                workId: customTierListItems.annictWorkId,
                tierKey: customTierListItems.tierKey,
                position: customTierListItems.position,
                title: annictWorks.title,
              })
              .from(customTierListItems)
              .innerJoin(
                annictWorks,
                eq(customTierListItems.annictWorkId, annictWorks.annictWorkId),
              )
              .where(inArray(customTierListItems.customTierListId, customIds)),
      ]);

      // tier の先頭順は tiersJson の並びで決める（tierKey 辞書順ではない）。
      const tierOrderByList = new Map<string, string[]>();
      for (const row of rows) {
        tierOrderByList.set(
          `${row.kind}:${row.id}`,
          parseTiersJson(row.tiersJson).map((t) => t.key),
        );
      }

      for (const row of rows) {
        const listKey = `${row.kind}:${row.id}`;
        const order = tierOrderByList.get(listKey) ?? [];
        const rankOf = (tierKey: string) => {
          const i = order.indexOf(tierKey);
          // tiersJson に無い tierKey のアイテムは末尾扱い
          // （保存データの整合性が崩れた場合でも一覧は出せるようにする）。
          return i === -1 ? order.length : i;
        };
        const source =
          row.kind === "season"
            ? seasonItems.filter((i) => i.listId === row.id)
            : row.kind === "character"
              ? characterItems.filter((i) => i.listId === row.id)
              : customItems.filter((i) => i.listId === row.id);
        const sorted = [...source].sort(
          (a, b) =>
            rankOf(a.tierKey) - rankOf(b.tierKey) || a.position - b.position,
        );
        const thumbs: PublicTierListThumb[] = [];
        for (const item of sorted) {
          if (thumbs.length >= THUMB_COUNT) break;
          if (row.kind === "character") {
            thumbs.push({
              kind: "character",
              imageUrl: "imageUrl" in item ? item.imageUrl : null,
              name: "name" in item ? item.name : "",
            });
          } else {
            thumbs.push({
              kind: "work",
              annictWorkId: "workId" in item ? item.workId : 0,
              title: "title" in item ? item.title : "",
            });
          }
        }
        result.set(listKey, thumbs);
      }
      return result;
    },
  };
}

export type PublicTierListsRepository = ReturnType<
  typeof publicTierListsRepository
>;
