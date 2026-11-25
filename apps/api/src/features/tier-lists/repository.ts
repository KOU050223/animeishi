import { and, desc, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import {
  annictCharacters,
  annictWorks,
  tierLists,
  tierListItems,
} from "@/db/schema";
import type { TierList, TierListKind } from "@/db/schema";
import type { AnnictWorkMeta } from "../works/repository";

/** tier 表に配置された作品 1 件（作品メタを含む）。season / custom 用。 */
export type TierListItemWithWork = {
  kind: "work";
  annictWorkId: number;
  tierKey: string;
  position: number;
} & AnnictWorkMeta;

/** tier 表に配置されたキャラクター 1 件（キャラメタを含む）。character 用。 */
export type TierListItemWithCharacter = {
  kind: "character";
  annictCharacterId: number;
  tierKey: string;
  position: number;
  name: string;
  nameKana: string | null;
  nameEn: string | null;
  imageUrl: string | null;
};

export type TierListItem = TierListItemWithWork | TierListItemWithCharacter;

/** tier 表 1 件と、その配置内容。 */
export type TierListWithItems = TierList & { items: TierListItem[] };

/** tier 表を保存するときの 1 配置。position は配列順から採番するので受け取らない。 */
export type TierListItemInput = {
  annictWorkId: number | null;
  annictCharacterId: number | null;
  tierKey: string;
  position: number;
};

/**
 * tier 表 1 件分の配置をメタ付きで取得する（position 昇順）。
 * 共有リンク（features/share）や公開詳細（features/public-tier-lists）からの
 * 参照でも使うため、ユーザー束縛リポジトリとは別の公開関数として切り出してある。
 * 1 表の items は kind に応じて作品かキャラクターのどちらか一方なので、
 * 片側の JOIN は必ず空になる。
 */
export async function fetchTierListItems(
  db: DrizzleDb,
  tierListId: number,
): Promise<TierListItem[]> {
  const [workItems, characterItems] = await Promise.all([
    db
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
        imageR2Key: annictWorks.imageR2Key,
        watchersCount: annictWorks.watchersCount,
      })
      .from(tierListItems)
      .innerJoin(
        annictWorks,
        eq(tierListItems.annictWorkId, annictWorks.annictWorkId),
      )
      .where(eq(tierListItems.tierListId, tierListId))
      .orderBy(tierListItems.position),
    db
      .select({
        annictCharacterId: tierListItems.annictCharacterId,
        tierKey: tierListItems.tierKey,
        position: tierListItems.position,
        name: annictCharacters.name,
        nameKana: annictCharacters.nameKana,
        nameEn: annictCharacters.nameEn,
        imageUrl: annictCharacters.imageUrl,
      })
      .from(tierListItems)
      .innerJoin(
        annictCharacters,
        eq(tierListItems.annictCharacterId, annictCharacters.annictCharacterId),
      )
      .where(eq(tierListItems.tierListId, tierListId))
      .orderBy(tierListItems.position),
  ]);
  return [
    ...workItems.map((item): TierListItemWithWork => ({
      kind: "work",
      // annict_work_id は JOIN 条件なので非 NULL が確定している
      annictWorkId: item.annictWorkId!,
      tierKey: item.tierKey,
      position: item.position,
      title: item.title,
      titleKana: item.titleKana,
      titleEn: item.titleEn,
      seasonName: item.seasonName,
      seasonYear: item.seasonYear,
      imageUrl: item.imageUrl,
      resolvedImageUrl: item.resolvedImageUrl,
      imageSource: item.imageSource,
      imageR2Key: item.imageR2Key,
      watchersCount: item.watchersCount,
    })),
    ...characterItems.map((item): TierListItemWithCharacter => ({
      kind: "character",
      annictCharacterId: item.annictCharacterId!,
      tierKey: item.tierKey,
      position: item.position,
      name: item.name,
      nameKana: item.nameKana,
      nameEn: item.nameEn,
      imageUrl: item.imageUrl,
    })),
  ];
}

/** 保存入力。対象スコープ（season / annictWorkId）は kind に応じて必須。 */
export type TierListSaveInput = {
  kind: TierListKind;
  season?: string | undefined;
  annictWorkId?: number | undefined;
  title: string;
  // description / isPublic は undefined なら触らない
  // （作成=既定値、更新=既存値を維持）。issue #476。
  description?: string | null | undefined;
  tiersJson: string;
  isPublic?: boolean | undefined;
  items: TierListItemInput[];
};

/**
 * tierListsRepository: 認証済みユーザーIDを束縛した tier_lists ドメインの
 * リポジトリ層（issue #724 で 3 系統を統合）。
 */
export function tierListsRepository(db: DrizzleDb, currentUserId: string) {
  /** スコープキー（kind + season / annictWorkId）での既存表の検索条件。 */
  function subjectCondition(input: {
    kind: TierListKind;
    season?: string | undefined;
    annictWorkId?: number | undefined;
  }) {
    if (input.kind === "season") {
      return and(
        eq(tierLists.userId, currentUserId),
        eq(tierLists.kind, "season"),
        eq(tierLists.season, input.season ?? ""),
      );
    }
    if (input.kind === "character") {
      return and(
        eq(tierLists.userId, currentUserId),
        eq(tierLists.kind, "character"),
        eq(tierLists.annictWorkId, input.annictWorkId ?? -1),
      );
    }
    return undefined;
  }

  /** items を全削除 → 全挿入で置き換える。 */
  async function replaceItems(
    tierListId: number,
    items: TierListItemInput[],
  ): Promise<void> {
    // items の全削除→全挿入は db.batch() でアトミックに実行する。
    // 逐次実行だと insert 途中の失敗で items が消えたまま残り、
    // 同一ユーザーの並行 PUT で delete/insert が交互に走って配置が混ざる。
    const queries: BatchItem<"sqlite">[] = [
      db.delete(tierListItems).where(eq(tierListItems.tierListId, tierListId)),
    ];
    // 1 行あたり 5 カラム。D1 のバインド変数上限 100 を下回るようチャンクする。
    const ITEM_CHUNK = 16; // 16 * 5 = 80 < 100
    for (let i = 0; i < items.length; i += ITEM_CHUNK) {
      queries.push(
        db.insert(tierListItems).values(
          items.slice(i, i + ITEM_CHUNK).map((item) => ({
            tierListId,
            annictWorkId: item.annictWorkId,
            annictCharacterId: item.annictCharacterId,
            tierKey: item.tierKey,
            position: item.position,
          })),
        ),
      );
    }
    await db.batch(queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  return {
    /**
     * tier 表を配置内容ごと取得する。他人の表も 404 相当として
     * undefined を返す（存在を確かめられない）。
     */
    async getMyTierList(id: number): Promise<TierListWithItems | undefined> {
      const list = await db.query.tierLists.findFirst({
        where: and(eq(tierLists.id, id), eq(tierLists.userId, currentUserId)),
      });
      if (!list) return undefined;

      const items = await fetchTierListItems(db, list.id);
      return { ...list, items };
    },

    /**
     * 自分の tier 表を新しい順に一覧する（配置内容は含めない）。
     * kind / season / annictWorkId で絞り込める。シーズン・作品の
     * 編集画面が「そのスコープの表」を引くのに使う。
     */
    async getMyTierLists(filter?: {
      kind?: TierListKind | undefined;
      season?: string | undefined;
      annictWorkId?: number | undefined;
    }): Promise<TierList[]> {
      return db
        .select()
        .from(tierLists)
        .where(
          and(
            eq(tierLists.userId, currentUserId),
            filter?.kind ? eq(tierLists.kind, filter.kind) : undefined,
            filter?.season !== undefined
              ? eq(tierLists.season, filter.season)
              : undefined,
            filter?.annictWorkId !== undefined
              ? eq(tierLists.annictWorkId, filter.annictWorkId)
              : undefined,
          ),
        )
        .orderBy(desc(tierLists.updatedAt));
    },

    /**
     * tier 表を丸ごと保存する。
     * - season / character: スコープキー（1 ユーザー 1 シーズン / 1 作品
     *   1 表）で upsert。既存があれば全置換。
     * - custom: スコープキーを持たず複数作れるため常に新規作成。
     *
     * 差分 UPDATE ではなく「items を全削除 → 全挿入」にしている。ドラッグ&ドロップの
     * 並べ替えは 1 回の操作で多数の position が動くため、差分計算のコストと
     * 不整合リスクに見合わない。
     */
    async saveMyTierList(
      input: TierListSaveInput,
    ): Promise<{ tierList: TierListWithItems; created: boolean }> {
      const now = new Date();
      // 「新規作成か」は書き込み件数で判定する。upsert 1 本だと insert / update の
      // どちらが走ったかが分からず、事前 SELECT だと並行リクエストで両方が
      // 「未作成」と誤判定して活動記録が重複する。createdAt は初回のみ。
      const inserted = await db
        .insert(tierLists)
        .values({
          userId: currentUserId,
          kind: input.kind,
          season: input.season ?? null,
          annictWorkId: input.annictWorkId ?? null,
          title: input.title,
          description: input.description ?? null,
          tiersJson: input.tiersJson,
          isPublic: input.isPublic ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const created = inserted.meta.changes === 1;
      const condition = subjectCondition(input);
      if (!created && condition !== undefined) {
        await db
          .update(tierLists)
          .set({
            title: input.title,
            tiersJson: input.tiersJson,
            ...(input.description !== undefined && {
              description: input.description,
            }),
            ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
            updatedAt: now,
          })
          .where(condition);
      }

      const saved = condition
        ? await db.query.tierLists.findFirst({ where: condition })
        : await db.query.tierLists.findFirst({
            where: eq(tierLists.id, Number(inserted.meta.last_row_id)),
          });
      if (!saved) throw new Error("tier 表の保存に失敗しました");

      await replaceItems(saved.id, input.items);

      const result = await this.getMyTierList(saved.id);
      if (!result) throw new Error("tier 表の保存に失敗しました");
      return { tierList: result, created };
    },

    /**
     * id 指定の全置換更新（PUT）。kind や対象スコープは作成時に
     * 決まるため変えられない。他人の表・未作成は undefined。
     */
    async updateMyTierList(
      id: number,
      input: Omit<TierListSaveInput, "kind" | "season" | "annictWorkId">,
    ): Promise<TierListWithItems | undefined> {
      const existing = await db.query.tierLists.findFirst({
        where: and(eq(tierLists.id, id), eq(tierLists.userId, currentUserId)),
        columns: { id: true },
      });
      if (!existing) return undefined;

      await db
        .update(tierLists)
        .set({
          title: input.title,
          tiersJson: input.tiersJson,
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
          updatedAt: new Date(),
        })
        .where(eq(tierLists.id, id));

      await replaceItems(id, input.items);
      return this.getMyTierList(id);
    },

    /**
     * tier 表の共有トークンを発行する。
     * 既に発行済みなら同じトークンを返す（共有リンクは一度配ったら変えない方が
     * 受け取り側でリンク切れにならないため）。表が未作成・他人のものなら undefined。
     * issuedNow はこの呼び出しで新たに発行したときだけ true（活動記録が
     * 「共有した」を 1 回だけ記録するための判定）。
     */
    async shareMyTierList(
      id: number,
    ): Promise<
      { shareToken: string; issuedNow: boolean; title: string } | undefined
    > {
      const list = await db.query.tierLists.findFirst({
        where: and(eq(tierLists.id, id), eq(tierLists.userId, currentUserId)),
      });
      if (!list) return undefined;
      if (list.shareToken) {
        return {
          shareToken: list.shareToken,
          issuedNow: false,
          title: list.title,
        };
      }

      // 発行は share_token がまだ null の場合だけに絞る。
      // 同一表への並行リクエストで両方が null を読んでも、後から UPDATE した
      // 側が先のトークンを上書きしてリンク切れにする競合を防ぐため、
      // 条件付き UPDATE にしてから DB の値を読み直して返す。
      const issued = await db
        .update(tierLists)
        .set({ shareToken: crypto.randomUUID() })
        .where(and(eq(tierLists.id, list.id), isNull(tierLists.shareToken)));
      const updated = await db.query.tierLists.findFirst({
        where: eq(tierLists.id, list.id),
        columns: { shareToken: true },
      });
      if (!updated?.shareToken) return undefined;
      return {
        shareToken: updated.shareToken,
        issuedNow: issued.meta.changes === 1,
        title: list.title,
      };
    },

    /**
     * 共有トークンを破棄する。破棄後は公開エンドポイントが 404 を返す。
     * 表が未作成・他人のものなら false。
     */
    async unshareMyTierList(id: number): Promise<boolean> {
      const list = await db.query.tierLists.findFirst({
        where: and(eq(tierLists.id, id), eq(tierLists.userId, currentUserId)),
        columns: { id: true },
      });
      if (!list) return false;
      await db
        .update(tierLists)
        .set({ shareToken: null })
        .where(eq(tierLists.id, list.id));
      return true;
    },

    /**
     * tier 表を削除する。items / tier_list_likes / 通報は FK の CASCADE で
     * 消える（CASCADE も changes に数えられるため、meta.changes ではなく
     * 事前の存在確認で成否を判定する）。他人の表・未作成は false。
     */
    async deleteMyTierList(id: number): Promise<boolean> {
      const list = await db.query.tierLists.findFirst({
        where: and(eq(tierLists.id, id), eq(tierLists.userId, currentUserId)),
        columns: { id: true },
      });
      if (!list) return false;
      await db.delete(tierLists).where(eq(tierLists.id, list.id));
      return true;
    },
  };
}
