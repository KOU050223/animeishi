import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import {
  annictWorks,
  blocks,
  users,
  workLists,
  workListItems,
  workListLikes,
} from "@/db/schema";
import type { WorkList } from "@/db/schema";
import type { AnnictWorkMeta } from "../works/repository";

/** 作品リストに登録された作品 1 件（作品メタを含む）。 */
export type WorkListItemWithWork = {
  annictWorkId: number;
  position: number;
} & AnnictWorkMeta;

/** 作品リスト 1 件と、その内容。 */
export type WorkListWithItems = WorkList & {
  items: WorkListItemWithWork[];
};

/** 一覧行。内容は含めず、代わりに登録作品数を持つ。 */
export type WorkListSummary = WorkList & {
  itemCount: number;
  /**
   * getMyWorkLists に containsWorkId を渡したとき、その作品が
   * リストに入っているか。未指定時は常に false。
   */
  containsWork: boolean;
};

/** 作品リストを保存するときの 1 項目。position は配列順から採番するので受け取らない。 */
export type WorkListItemInput = {
  annictWorkId: number;
  position: number;
};

/**
 * 自分の公開リストへのいいね・通報など、所有者には許さない操作を
 * 受けたときに投げるエラー（issue #422）。ルート層で 400 に変換する。
 */
export class OwnWorkListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnWorkListError";
  }
}

/** 公開一覧の 1 件。カード表示に必要なサマリ（内容の作品一覧は含まない）。 */
export type PublicWorkListRow = {
  id: number;
  title: string;
  description: string | null;
  createdAt: Date;
  owner: {
    userId: string;
    username: string;
    profileImageUrl: string | null;
  };
  itemCount: number;
  likeCount: number;
  likedByMe: boolean;
};

/** 公開一覧の並び順。「likes」= いいね数順、「new」= 新着順。 */
export type PublicWorkListSort = "likes" | "new";

/** 公開リストの詳細。一覧のサマリに加えて内容の作品一覧を含む。 */
export type PublicWorkListDetail = PublicWorkListRow & {
  items: WorkListItemWithWork[];
};

// 公開一覧のカードに載せるサムネイルの最大枚数（position 昇順の先頭から）。
export const PUBLIC_LIST_THUMBNAILS = 3;

// 公開一覧で「見えるリスト」の条件（issue #422）。
// - リストが公開（is_public）
// - 所有者のプロフィールが公開（users.is_public）
// - 閲覧者と所有者の間にブロック関係が無い（どちら方向でも）
// 一覧・いいね・通報の対象解決で共通に使う。
function publicListVisibility(
  db: DrizzleDb,
  currentUserId: string,
): ReturnType<typeof and> {
  return and(
    eq(workLists.isPublic, true),
    eq(users.isPublic, true),
    notExists(
      db
        .select({ one: sql`1` })
        .from(blocks)
        .where(
          or(
            and(
              eq(blocks.blockerId, currentUserId),
              eq(blocks.blockedId, workLists.userId),
            ),
            and(
              eq(blocks.blockerId, workLists.userId),
              eq(blocks.blockedId, currentUserId),
            ),
          ),
        ),
    ),
  );
}

/**
 * 作品リスト 1 件分の内容を作品メタ付きで取得する（position 昇順）。
 * 共有リンク（features/share）からの公開参照でも使うため、
 * ユーザー束縛リポジトリとは別の公開関数として切り出してある。
 */
export async function fetchWorkListItems(
  db: DrizzleDb,
  workListId: number,
): Promise<WorkListItemWithWork[]> {
  return db
    .select({
      annictWorkId: workListItems.annictWorkId,
      position: workListItems.position,
      title: annictWorks.title,
      titleKana: annictWorks.titleKana,
      titleEn: annictWorks.titleEn,
      seasonName: annictWorks.seasonName,
      seasonYear: annictWorks.seasonYear,
      imageUrl: annictWorks.imageUrl,
      resolvedImageUrl: annictWorks.resolvedImageUrl,
      imageSource: annictWorks.imageSource,
      imageR2Key: annictWorks.imageR2Key,
      watchersCount: annictWorks.watchersCount,
    })
    .from(workListItems)
    .innerJoin(
      annictWorks,
      eq(workListItems.annictWorkId, annictWorks.annictWorkId),
    )
    .where(eq(workListItems.workListId, workListId))
    .orderBy(workListItems.position);
}

/**
 * 指定リスト群の先頭作品（position 昇順で各 perList 件）の作品メタを
 * 返す。公開一覧カードのサムネイル用（issue #422）。title は画像が
 * 無い作品の代替表示に使う（issue #522）。
 * ウィンドウ関数ではなく、ページ内の件数が少ない前提で全件引いて
 * アプリ側で切る（ユーザー一覧と違い 1 ページ = 最大 50 リスト ×
 * 数百作品までしか増えない）。
 */
export async function fetchWorkListTopWorks(
  db: DrizzleDb,
  workListIds: number[],
  perList: number,
): Promise<Map<number, { annictWorkId: number; title: string }[]>> {
  const result = new Map<number, { annictWorkId: number; title: string }[]>();
  if (workListIds.length === 0) return result;

  const rows = await db
    .select({
      workListId: workListItems.workListId,
      annictWorkId: workListItems.annictWorkId,
      title: annictWorks.title,
    })
    .from(workListItems)
    .innerJoin(
      annictWorks,
      eq(workListItems.annictWorkId, annictWorks.annictWorkId),
    )
    .where(inArray(workListItems.workListId, workListIds))
    .orderBy(workListItems.position);

  for (const row of rows) {
    const list = result.get(row.workListId) ?? [];
    if (list.length < perList) {
      list.push({ annictWorkId: row.annictWorkId, title: row.title });
      result.set(row.workListId, list);
    }
  }
  return result;
}

/**
 * workListsRepository: 認証済みユーザーIDを束縛した
 * work_lists ドメインのリポジトリ層。
 * 1 人で複数作れるためスコープキーを持たず、すべて id 指定で操作する
 * （customTierListsRepository と同じ構造）。
 */
export function workListsRepository(db: DrizzleDb, currentUserId: string) {
  // id 指定の操作はすべて「自分のリストか」の確認を兼ねるため、
  // userId 条件付きで引く共通の検索にまとめる。
  const findMyList = (id: number) =>
    db.query.workLists.findFirst({
      where: (t, { and: and_, eq: eq_ }) =>
        and_(eq_(t.userId, currentUserId), eq_(t.id, id)),
    });

  return {
    /**
     * 指定 id の作品リストを内容ごと取得する。未作成・他人のリストは
     * undefined。内容は annict_works と JOIN して作品メタを同梱する。
     */
    async getMyWorkList(id: number): Promise<WorkListWithItems | undefined> {
      const list = await findMyList(id);
      if (!list) return undefined;

      const items = await fetchWorkListItems(db, list.id);
      return { ...list, items };
    },

    /**
     * 自分の作品リストを新しい順に一覧する（内容は含めず、
     * 一覧表示用に登録作品数だけを付ける）。
     * containsWorkId を渡すと、その作品が各リストに入っているかの
     * フラグを付ける（「リストに追加」シートの追加済み表示用。issue #377）。
     */
    async getMyWorkLists(containsWorkId?: number): Promise<WorkListSummary[]> {
      const rows = await db
        .select({ list: workLists, itemCount: count(workListItems.id) })
        .from(workLists)
        .leftJoin(workListItems, eq(workListItems.workListId, workLists.id))
        .where(eq(workLists.userId, currentUserId))
        .groupBy(workLists.id)
        .orderBy(desc(workLists.updatedAt));

      let containingIds = new Set<number>();
      if (containsWorkId !== undefined) {
        const containing = await db
          .select({ workListId: workListItems.workListId })
          .from(workListItems)
          .innerJoin(workLists, eq(workListItems.workListId, workLists.id))
          .where(
            and(
              eq(workLists.userId, currentUserId),
              eq(workListItems.annictWorkId, containsWorkId),
            ),
          );
        containingIds = new Set(containing.map((row) => row.workListId));
      }

      return rows.map((row) => ({
        ...row.list,
        itemCount: row.itemCount,
        containsWork: containingIds.has(row.list.id),
      }));
    },

    /**
     * 作品リストを丸ごと保存する（作成 or 全置換）。
     * id 省略時は新規作成、id 指定時はそのリストの全置換（自分のリストで
     * なければ undefined を返してルート側で 404 にする）。
     *
     * items の差し替えは「全削除 → 全挿入」を db.batch() でアトミックに
     * 行う（並べ替えで多数の position が一度に動くため、部分更新ではなく
     * 全置換。custom_tier_lists と同じ考え方）。
     */
    async saveMyWorkList(input: {
      id?: number;
      title: string;
      description: string | null;
      // 公開設定（issue #422）。省略時は新規=非公開、更新=既存値を維持する。
      isPublic?: boolean | undefined;
      items: WorkListItemInput[];
    }): Promise<{ workList: WorkListWithItems; created: boolean } | undefined> {
      const now = new Date();
      let savedId: number;
      let created = false;

      if (input.id === undefined) {
        const inserted = await db
          .insert(workLists)
          .values({
            userId: currentUserId,
            title: input.title,
            description: input.description,
            isPublic: input.isPublic ?? false,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: workLists.id });
        savedId = inserted[0]!.id;
        created = true;
      } else {
        // 自分のリストだけを更新対象にする。他人の id を PUT しても
        // changes=0 になるので、存在しないリストと同じく 404 に倒す。
        const updated = await db
          .update(workLists)
          .set({
            title: input.title,
            description: input.description,
            // isPublic 省略時は既存値を維持する（未対応クライアントの
            // 全置換 PUT で公開設定が消えないようにする）。
            ...(input.isPublic !== undefined
              ? { isPublic: input.isPublic }
              : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(workLists.id, input.id),
              eq(workLists.userId, currentUserId),
            ),
          );
        if (updated.meta.changes === 0) return undefined;
        savedId = input.id;
      }

      const queries: BatchItem<"sqlite">[] = [
        db.delete(workListItems).where(eq(workListItems.workListId, savedId)),
      ];
      // 1 行あたり 3 カラム。D1 のバインド変数上限 100 を下回るようチャンクする。
      const ITEM_CHUNK = 30;
      for (let i = 0; i < input.items.length; i += ITEM_CHUNK) {
        queries.push(
          db.insert(workListItems).values(
            input.items.slice(i, i + ITEM_CHUNK).map((item) => ({
              workListId: savedId,
              annictWorkId: item.annictWorkId,
              position: item.position,
            })),
          ),
        );
      }
      await db.batch(
        queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );

      const result = await this.getMyWorkList(savedId);
      if (!result) throw new Error("作品リストの保存に失敗しました");
      return { workList: result, created };
    },

    /**
     * 作品 1 件をリストの末尾に追加する（issue #377）。
     * アニメ一覧からの「リストに追加」は 1 件ずつの操作なので、全置換
     * （saveMyWorkList）を要求すると先に内容の取得が必要になり、編集画面
     * と並行して保存されたとき最後の書き込みで相手の変更が消える。
     * 末尾追加をサーバ側で行い、その競合を避ける。
     *
     * 既に入っている作品は no-op で現在のリストを返す（added: false）。
     * work_list_items の (workListId, annictWorkId) unique がDB側でも
     * 二重追加を防ぐ。自分のリストでなければ undefined。
     */
    async addMyWorkListItem(
      id: number,
      annictWorkId: number,
    ): Promise<{ workList: WorkListWithItems; added: boolean } | undefined> {
      const list = await findMyList(id);
      if (!list) return undefined;

      const existing = await db.query.workListItems.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.workListId, id), eq_(t.annictWorkId, annictWorkId)),
      });

      if (!existing) {
        await db.batch([
          db
            .insert(workListItems)
            .values({
              workListId: id,
              annictWorkId,
              // 末尾 position は INSERT 内の副問合せで採番する。batch 前に
              // SELECT で取ると、別作品への同時追加が同じ最大値を読んで
              // 同じ position の行を作り、末尾順の契約が壊れる。
              position: sql<number>`(select coalesce(max(${workListItems.position}), -1) + 1 from ${workListItems} where ${workListItems.workListId} = ${id})`,
            })
            // 同一作品への同時追加は上の存在確認をすり抜けて
            // (workListId, annictWorkId) unique 違反になり 500 になるので、
            // no-op 契約どおり現在のリストを返せるよう握り潰す。
            .onConflictDoNothing(),
          // updatedAt を進めて getMyWorkLists の新しい順の先頭に来る
          // ようにする（最後に触ったリストが上に来る保存と同じ扱い）。
          db
            .update(workLists)
            .set({ updatedAt: new Date() })
            .where(eq(workLists.id, id)),
        ]);
      }

      const workList = await this.getMyWorkList(id);
      if (!workList) throw new Error("作品リストの取得に失敗しました");
      return { workList, added: !existing };
    },

    /**
     * 指定 id の作品リストの共有トークンを発行する。
     * 既に発行済みなら同じトークンを返す（tier 表と同じ理由）。
     * リストが未作成・他人のものなら undefined。
     */
    async shareMyWorkList(
      id: number,
    ): Promise<{ shareToken: string; issuedNow: boolean } | undefined> {
      const list = await findMyList(id);
      if (!list) return undefined;
      if (list.shareToken) {
        return { shareToken: list.shareToken, issuedNow: false };
      }

      // 条件付き UPDATE + 読み直しで、並行リクエストが先のトークンを
      // 上書きする競合を防ぐ（tier 表と同じ構造）。
      const issued = await db
        .update(workLists)
        .set({ shareToken: crypto.randomUUID() })
        .where(and(eq(workLists.id, list.id), isNull(workLists.shareToken)));
      const updated = await db.query.workLists.findFirst({
        where: eq(workLists.id, list.id),
        columns: { shareToken: true },
      });
      if (!updated?.shareToken) return undefined;
      return {
        shareToken: updated.shareToken,
        issuedNow: issued.meta.changes === 1,
      };
    },

    /**
     * 共有トークンを破棄する。破棄後は公開エンドポイントが 404 を返す。
     * リストが未作成・他人のものなら false。
     */
    async unshareMyWorkList(id: number): Promise<boolean> {
      const list = await findMyList(id);
      if (!list) return false;
      await db
        .update(workLists)
        .set({ shareToken: null })
        .where(eq(workLists.id, list.id));
      return true;
    },

    /**
     * 指定 id の作品リストを削除する。items は FK の CASCADE で消える。
     * 削除したか（＝自分のリストだったか）を返す。
     */
    async deleteMyWorkList(id: number): Promise<boolean> {
      const list = await findMyList(id);
      if (!list) return false;
      await db.delete(workLists).where(eq(workLists.id, list.id));
      return true;
    },

    /**
     * 公開設定（is_public）の作品リストを一覧する（issue #422）。
     * 非公開ユーザー（users.is_public=false）のリストと、閲覧者とブロック
     * 関係（どちら方向でも）にある所有者のリストは除く。
     *
     * ページングはキーセット方式で limit+1 件まで返す（+1 は次ページの
     * 有無判定。feed と同じ考え方）。
     * - sort="new": id 降順。cursor は前ページ最後尾のリスト id。
     * - sort="likes": いいね数降順 → id 降順。いいね数は変動するため
     *   カーソルは (いいね数, id) の複合キーが必要（id だけだと順位が
     *   動いたとき重複・抜けが出る）。
     */
    async getPublicWorkLists(opts: {
      sort: PublicWorkListSort;
      cursor?: { id: number; likeCount?: number | undefined } | undefined;
      limit: number;
    }): Promise<PublicWorkListRow[]> {
      // いいね数・自分のいいね済みか・登録作品数は相関副問い合わせで
      // 求める（issue #422 の実装メモどおり都度 COUNT。重くなったら
      // like_count の非正規化を検討する）。
      const likeCountExpr = sql<number>`(select count(*) from ${workListLikes} where ${workListLikes.workListId} = ${workLists.id})`;
      const cursorCondition =
        opts.cursor === undefined
          ? undefined
          : opts.sort === "likes"
            ? or(
                lt(likeCountExpr, opts.cursor.likeCount ?? 0),
                and(
                  eq(likeCountExpr, opts.cursor.likeCount ?? 0),
                  lt(workLists.id, opts.cursor.id),
                ),
              )
            : lt(workLists.id, opts.cursor.id);

      const rows = await db
        .select({
          id: workLists.id,
          title: workLists.title,
          description: workLists.description,
          createdAt: workLists.createdAt,
          ownerUserId: users.id,
          ownerUsername: users.username,
          ownerProfileImageUrl: users.profileImageUrl,
          itemCount:
            sql<number>`(select count(*) from ${workListItems} where ${workListItems.workListId} = ${workLists.id})`.as(
              "item_count",
            ),
          likeCount: sql<number>`${likeCountExpr}`.as("like_count"),
          likedByMe:
            sql<number>`exists(select 1 from ${workListLikes} where ${workListLikes.workListId} = ${workLists.id} and ${workListLikes.userId} = ${currentUserId})`.as(
              "liked_by_me",
            ),
        })
        .from(workLists)
        .innerJoin(users, eq(workLists.userId, users.id))
        .where(and(publicListVisibility(db, currentUserId), cursorCondition))
        .orderBy(
          ...(opts.sort === "likes"
            ? [desc(likeCountExpr), desc(workLists.id)]
            : [desc(workLists.id)]),
        )
        .limit(opts.limit + 1);

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        createdAt: row.createdAt,
        owner: {
          userId: row.ownerUserId,
          username: row.ownerUsername,
          profileImageUrl: row.ownerProfileImageUrl,
        },
        itemCount: row.itemCount,
        likeCount: row.likeCount,
        likedByMe: row.likedByMe === 1,
      }));
    },

    /**
     * 公開一覧に見えるリスト 1 件を引く（いいね・通報の対象解決用）。
     * 一覧と同じ可視条件（公開・所有者公開・非ブロック）を掛けるため、
     * 一覧に出ないリストの存在を id 指定で確かめられない。
     */
    async findPublicWorkList(id: number): Promise<WorkList | undefined> {
      // users.is_public の条件が要るため query API ではなく JOIN を掛ける。
      const rows = await db
        .select({ list: workLists })
        .from(workLists)
        .innerJoin(users, eq(workLists.userId, users.id))
        .where(
          and(eq(workLists.id, id), publicListVisibility(db, currentUserId)),
        );
      return rows[0]?.list;
    },

    /**
     * 公開一覧に見えるリストの詳細（登録作品つき）を返す（issue #422）。
     * 一覧カードの遷移先が読む画面用。可視条件は一覧・いいねと同じで、
     * 見えないリスト・未作成は undefined（ルート側 404）。
     */
    async getPublicWorkList(
      id: number,
    ): Promise<PublicWorkListDetail | undefined> {
      const list = await this.findPublicWorkList(id);
      if (!list) return undefined;

      // findPublicWorkList で users JOIN 済み（is_public 条件を含む）のため、
      // ここで引けないユーザーが対象になることはない。
      const owner = await db.query.users.findFirst({
        where: eq(users.id, list.userId),
        columns: { id: true, username: true, profileImageUrl: true },
      });
      if (!owner) return undefined;

      const [items, likeCount, like] = await Promise.all([
        fetchWorkListItems(db, id),
        this.countWorkListLikes(id),
        db.query.workListLikes.findFirst({
          where: (t, { and: and_, eq: eq_ }) =>
            and_(eq_(t.userId, currentUserId), eq_(t.workListId, id)),
          columns: { id: true },
        }),
      ]);

      return {
        id: list.id,
        title: list.title,
        description: list.description,
        createdAt: list.createdAt,
        owner: {
          userId: owner.id,
          username: owner.username,
          profileImageUrl: owner.profileImageUrl,
        },
        itemCount: items.length,
        likeCount,
        likedByMe: like !== undefined,
        items,
      };
    },

    /**
     * 公開リストにいいねする（冪等。issue #422）。
     * 見えないリスト（未公開・所有者非公開・ブロック関係）・未作成は
     * undefined でルート側 404。自分のリストにはいいね不可
     * （OwnWorkListError → 400）。
     */
    async likeWorkList(id: number): Promise<{ likeCount: number } | undefined> {
      const list = await this.findPublicWorkList(id);
      if (!list) return undefined;
      if (list.userId === currentUserId) {
        throw new OwnWorkListError("自分の作品リストにはいいねできません");
      }

      // (user_id, work_list_id) unique で二重いいねを防ぎ、
      // 既にいいね済みでも no-op で同じ応答を返す（冪等）。
      await db
        .insert(workListLikes)
        .values({
          userId: currentUserId,
          workListId: id,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
      return { likeCount: await this.countWorkListLikes(id) };
    },

    /**
     * いいねを取り消す（冪等。いいねしていなくても成功）。
     * 対象は一覧と同じ可視条件で解決し、見えないリストは undefined
     * （可視条件なしでいいね数を返すと、閲覧できないリストの反応数が
     * 漏れる。非公開化後の取り消しは一覧から消える時点で
     * likedByMe も見えなくなるため失ってよい）。
     */
    async unlikeWorkList(
      id: number,
    ): Promise<{ likeCount: number } | undefined> {
      const list = await this.findPublicWorkList(id);
      if (!list) return undefined;

      await db
        .delete(workListLikes)
        .where(
          and(
            eq(workListLikes.userId, currentUserId),
            eq(workListLikes.workListId, id),
          ),
        );
      return { likeCount: await this.countWorkListLikes(id) };
    },

    /** 指定リストのいいね数。 */
    async countWorkListLikes(id: number): Promise<number> {
      const rows = await db
        .select({ likeCount: count() })
        .from(workListLikes)
        .where(eq(workListLikes.workListId, id));
      return rows[0]?.likeCount ?? 0;
    },
  };
}

export type WorkListsRepository = ReturnType<typeof workListsRepository>;
