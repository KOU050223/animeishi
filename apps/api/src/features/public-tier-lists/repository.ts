import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  users,
  blocks,
  tierLists,
  tierListItems,
  tierListLikes,
  annictWorks,
  annictCharacters,
} from "@/db/schema";
import type { TierRow } from "../share/service";
import { parseTiersJson } from "../share/service";
import { fetchTierListItems } from "../tier-lists/repository";

export type PublicTierListsSort = "likes" | "new";

/** 一覧の行。レスポンスの owner / likeCount / thumbnails のもとになる。 */
export type PublicTierListRow = {
  kind: "season" | "character" | "custom";
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

/** 詳細レスポンス。items の形は features/tier-lists/repository.ts 参照。 */
export type PublicTierListDetail = Omit<PublicTierListRow, "tiersJson"> & {
  tiers: TierRow[];
  items: Awaited<ReturnType<typeof fetchTierListItems>>;
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
function visibilityCondition(db: DrizzleDb, currentUserId: string) {
  return and(
    eq(tierLists.isPublic, true),
    eq(users.isPublic, true),
    notExists(
      db
        .select({ one: sql`1` })
        .from(blocks)
        .where(
          or(
            and(
              eq(blocks.blockerId, currentUserId),
              eq(blocks.blockedId, tierLists.userId),
            ),
            and(
              eq(blocks.blockerId, tierLists.userId),
              eq(blocks.blockedId, currentUserId),
            ),
          ),
        ),
    ),
  );
}

const likeCountExpr = sql<number>`(
  SELECT COUNT(*) FROM ${tierListLikes}
  WHERE ${tierListLikes.tierListId} = ${tierLists.id}
)`;

function likedByMeExpr(currentUserId: string) {
  return sql<number>`EXISTS (
    SELECT 1 FROM ${tierListLikes}
    WHERE ${tierListLikes.userId} = ${currentUserId}
      AND ${tierListLikes.tierListId} = ${tierLists.id}
  )`;
}

/**
 * cursor は公開作品リストと同じ形式。
 * - sort="new": 前ページ最後尾のリスト id（id 降順で辿る）
 * - sort="likes": "<いいね数>_<id>"（いいね数降順 → id 降順）
 */
export type ParsedCursor = { id: number; likeCount?: number };

export function parsePublicTierListCursor(
  sort: PublicTierListsSort,
  cursor: string,
): ParsedCursor | undefined {
  if (sort === "new") {
    return /^\d+$/.test(cursor) ? { id: Number(cursor) } : undefined;
  }
  const m = /^(\d+)_(\d+)$/.exec(cursor);
  return m ? { likeCount: Number(m[1]), id: Number(m[2]) } : undefined;
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
  /** 公開範囲チェック付きの単一行取得（いいね・通報の対象解決に使う）。 */
  async function findPublicRow(
    id: number,
  ): Promise<{ id: number; userId: string; title: string } | null> {
    const rows = await db
      .select({
        id: tierLists.id,
        userId: tierLists.userId,
        title: tierLists.title,
      })
      .from(tierLists)
      .innerJoin(users, eq(tierLists.userId, users.id))
      .where(and(eq(tierLists.id, id), visibilityCondition(db, currentUserId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function fetchHead(id: number): Promise<PublicTierListRow | null> {
    const rows = await db
      .select({
        kind: tierLists.kind,
        id: tierLists.id,
        title: tierLists.title,
        description: tierLists.description,
        tiersJson: tierLists.tiersJson,
        createdAt: tierLists.createdAt,
        season: tierLists.season,
        annictWorkId: tierLists.annictWorkId,
        workTitle: annictWorks.title,
        ownerUserId: users.id,
        ownerUsername: users.username,
        ownerProfileImageUrl: users.profileImageUrl,
        itemCount: sql<number>`(
          SELECT COUNT(*) FROM ${tierListItems}
          WHERE ${tierListItems.tierListId} = ${tierLists.id}
        )`.as("item_count"),
        likeCount: sql<number>`${likeCountExpr}`.as("like_count"),
        likedByMe: sql<number>`${likedByMeExpr(currentUserId)}`.as(
          "liked_by_me",
        ),
      })
      .from(tierLists)
      .innerJoin(users, eq(tierLists.userId, users.id))
      // character 種別の対象作品名を載せるため LEFT JOIN（season / custom
      // では annict_work_id が NULL なので JOIN しない行は workTitle=null）。
      .leftJoin(
        annictWorks,
        eq(tierLists.annictWorkId, annictWorks.annictWorkId),
      )
      .where(and(eq(tierLists.id, id), visibilityCondition(db, currentUserId)))
      .limit(1);
    const r = rows[0];
    return r ? { ...r, likedByMe: r.likedByMe === 1 } : null;
  }

  return {
    /**
     * 公開 tier 表の一覧（カーソルページング）。統合で 1 テーブルになったため
     * ソート・カーソルは work_lists の公開一覧と同じ仕組み（issue #724）。
     */
    async getPublicTierLists(input: {
      sort: PublicTierListsSort;
      cursor?: ParsedCursor | undefined;
      limit: number;
    }): Promise<{ items: PublicTierListRow[]; hasMore: boolean }> {
      const cursorCondition =
        input.cursor === undefined
          ? undefined
          : input.sort === "likes"
            ? or(
                lt(likeCountExpr, input.cursor.likeCount ?? 0),
                and(
                  eq(likeCountExpr, input.cursor.likeCount ?? 0),
                  lt(tierLists.id, input.cursor.id),
                ),
              )
            : lt(tierLists.id, input.cursor.id);

      const rows = await db
        .select({
          kind: tierLists.kind,
          id: tierLists.id,
          title: tierLists.title,
          description: tierLists.description,
          tiersJson: tierLists.tiersJson,
          createdAt: tierLists.createdAt,
          season: tierLists.season,
          annictWorkId: tierLists.annictWorkId,
          workTitle: annictWorks.title,
          ownerUserId: users.id,
          ownerUsername: users.username,
          ownerProfileImageUrl: users.profileImageUrl,
          itemCount: sql<number>`(
            SELECT COUNT(*) FROM ${tierListItems}
            WHERE ${tierListItems.tierListId} = ${tierLists.id}
          )`.as("item_count"),
          likeCount: sql<number>`${likeCountExpr}`.as("like_count"),
          likedByMe: sql<number>`${likedByMeExpr(currentUserId)}`.as(
            "liked_by_me",
          ),
        })
        .from(tierLists)
        .innerJoin(users, eq(tierLists.userId, users.id))
        .leftJoin(
          annictWorks,
          eq(tierLists.annictWorkId, annictWorks.annictWorkId),
        )
        .where(
          and(
            visibilityCondition(db, currentUserId),
            // 公開一覧からの除外は一覧への露出だけに効かせる（issue #580）。
            // 詳細・いいね・通報の対象解決（visibilityCondition 側）には
            // 入れず、除外ユーザーの tier 表も id 指定の直接参照は残す
            // （デモアカウントの Explore リンクを壊さないため）。
            isNull(users.publicListExclusion),
            cursorCondition,
          ),
        )
        .orderBy(
          ...(input.sort === "likes"
            ? [desc(likeCountExpr), desc(tierLists.id)]
            : [desc(tierLists.id)]),
        )
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = rows
        .slice(0, input.limit)
        .map((r) => ({ ...r, likedByMe: r.likedByMe === 1 }));
      return { items, hasMore };
    },

    /** 公開範囲チェック付きの対象解決（通報で使う）。 */
    async findPublicTierList(id: number) {
      return findPublicRow(id);
    },

    /**
     * 公開 tier 表の詳細（閲覧専用）。
     * 公開範囲外（非公開・非公開オーナー・ブロック関係）は null（404）。
     */
    async getPublicTierList(id: number): Promise<PublicTierListDetail | null> {
      const head = await fetchHead(id);
      if (!head) return null;
      const { tiersJson, ...rest } = head;
      const items = await fetchTierListItems(db, id);
      return { ...rest, tiers: parseTiersJson(tiersJson), items };
    },

    /**
     * 公開 tier 表へのいいね（冪等。すでにいいねしていても成功）。
     * 公開範囲外（非公開・非公開オーナー・ブロック関係）は null（404）。
     * 自分のリストへのいいねは OwnTierListError（400）。
     */
    async likeTierList(id: number): Promise<{ likeCount: number } | null> {
      const row = await findPublicRow(id);
      if (!row) return null;
      if (row.userId === currentUserId) throw new OwnTierListError();
      await db
        .insert(tierListLikes)
        .values({
          userId: currentUserId,
          tierListId: id,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
      return { likeCount: await this.countTierListLikes(id) };
    },

    /**
     * 公開 tier 表へのいいね解除（冪等。いいねしていなくても成功）。
     * 公開範囲外は null（閲覧できないリストの反応数を返さない）。
     */
    async unlikeTierList(id: number): Promise<{ likeCount: number } | null> {
      const row = await findPublicRow(id);
      if (!row) return null;
      await db
        .delete(tierListLikes)
        .where(
          and(
            eq(tierListLikes.userId, currentUserId),
            eq(tierListLikes.tierListId, id),
          ),
        );
      return { likeCount: await this.countTierListLikes(id) };
    },

    /** リストの現在のいいね数。いいね/いいね解除のレスポンス用。 */
    async countTierListLikes(id: number): Promise<number> {
      const [row] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(tierListLikes)
        .where(eq(tierListLikes.tierListId, id));
      return row?.c ?? 0;
    },

    /**
     * 一覧ページ分のサムネイルをまとめて返す。キーはリスト id。
     * 先頭 tier の先頭アイテムから最大 THUMB_COUNT 個
     * （公開作品リストの「先頭 3 件」と同じ見せ方）。
     */
    async fetchThumbnails(
      rows: PublicTierListRow[],
    ): Promise<Map<number, PublicTierListThumb[]>> {
      const result = new Map<number, PublicTierListThumb[]>();
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return result;

      // ページ内リストの items を一括取得（N+1 回避）。作品アイテムと
      // キャラクターアイテムは排他（CHECK 制約）なので両方を引いて
      // リスト id で束ねる。どちらかは必ず空。
      const [workItems, characterItems] = await Promise.all([
        db
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
          .where(inArray(tierListItems.tierListId, ids)),
        db
          .select({
            listId: tierListItems.tierListId,
            characterId: tierListItems.annictCharacterId,
            tierKey: tierListItems.tierKey,
            position: tierListItems.position,
            imageUrl: annictCharacters.imageUrl,
            name: annictCharacters.name,
          })
          .from(tierListItems)
          .innerJoin(
            annictCharacters,
            eq(
              tierListItems.annictCharacterId,
              annictCharacters.annictCharacterId,
            ),
          )
          .where(inArray(tierListItems.tierListId, ids)),
      ]);

      const itemsByList = new Map<
        number,
        { tierKey: string; position: number; thumb: PublicTierListThumb }[]
      >();
      const push = (
        listId: number,
        entry: {
          tierKey: string;
          position: number;
          thumb: PublicTierListThumb;
        },
      ) => {
        const arr = itemsByList.get(listId) ?? [];
        arr.push(entry);
        itemsByList.set(listId, arr);
      };
      for (const item of workItems) {
        if (item.workId === null) continue;
        push(item.listId, {
          tierKey: item.tierKey,
          position: item.position,
          thumb: {
            kind: "work",
            annictWorkId: item.workId,
            title: item.title,
          },
        });
      }
      for (const item of characterItems) {
        if (item.characterId === null) continue;
        push(item.listId, {
          tierKey: item.tierKey,
          position: item.position,
          thumb: {
            kind: "character",
            imageUrl: item.imageUrl,
            name: item.name,
          },
        });
      }

      for (const row of rows) {
        // tier の先頭順は tiersJson の並びで決める（tierKey 辞書順ではない）。
        const order = parseTiersJson(row.tiersJson).map((t) => t.key);
        const rankOf = (tierKey: string) => {
          const i = order.indexOf(tierKey);
          // tiersJson に無い tierKey のアイテムは末尾扱い
          // （保存データの整合性が崩れた場合でも一覧は出せるようにする）。
          return i === -1 ? order.length : i;
        };
        const sorted = (itemsByList.get(row.id) ?? []).toSorted(
          (a, b) =>
            rankOf(a.tierKey) - rankOf(b.tierKey) || a.position - b.position,
        );
        result.set(
          row.id,
          sorted.slice(0, THUMB_COUNT).map((item) => item.thumb),
        );
      }
      return result;
    },
  };
}
