import { eq } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { animeTitles } from "@/db/schema";
import type { NewAnimeTitle } from "@/db/schema";

/**
 * 外部ソース（しょぼいカレンダー等）から取得したアニメ 1 件分の正規化済みデータ。
 * バッチが取り込む際の入力フォーマット。
 */
export type AnimeSyncInput = Omit<
  NewAnimeTitle,
  "id" | "createdAt" | "updatedAt"
>;

/** 同期バッチ 1 回分の結果サマリ。Cache Purge の要否判定やログ出力に使う。 */
export type AnimeSyncResult = {
  /** 新規に追加された件数 */
  inserted: number;
  /** 既存レコードを更新した件数 */
  updated: number;
  /** 変更がなくスキップした件数 */
  skipped: number;
};

/**
 * バッチ（Cron）専用のアニメマスター書き込みリポジトリ。
 *
 * authorizedDb はユーザー単位の操作を束縛する層であり、
 * 全ユーザー共通のマスターデータをシステム側で一括更新するバッチとは責務が異なるため、
 * 専用のリポジトリとして分離する。
 * （DB の insert/update はリポジトリ層に閉じる方針 = ESLint no-direct-db ルールに従う）
 */
export function animeSyncRepo(db: DrizzleDb) {
  /**
   * 既存レコードを 1 件特定する。
   * 外部ソース ID（sourceId）があればそれを安定キーに突き合わせる。
   * sourceId を持たない入力（手動投入相当）は title をフォールバックキーにする。
   */
  async function findExisting(input: AnimeSyncInput) {
    if (input.sourceId) {
      return db.query.animeTitles.findFirst({
        where: eq(animeTitles.sourceId, input.sourceId),
      });
    }
    return db.query.animeTitles.findFirst({
      where: eq(animeTitles.title, input.title),
    });
  }

  /**
   * 1 件を upsert する。既存と内容が同一なら書き込みをスキップし、
   * updatedAt の無駄な更新を避ける。
   */
  async function upsertOne(
    input: AnimeSyncInput,
    now: Date,
  ): Promise<"inserted" | "updated" | "skipped"> {
    const existing = await findExisting(input);

    if (!existing) {
      await db
        .insert(animeTitles)
        .values({ ...input, createdAt: now, updatedAt: now });
      return "inserted";
    }

    if (!hasChanges(existing, input)) {
      return "skipped";
    }

    await db
      .update(animeTitles)
      .set({ ...input, updatedAt: now })
      .where(eq(animeTitles.id, existing.id));
    return "updated";
  }

  return {
    /**
     * アニメ一覧を一括 upsert する。
     * @returns 追加・更新・スキップの件数サマリ
     */
    async syncAnimeTitles(inputs: AnimeSyncInput[]): Promise<AnimeSyncResult> {
      const now = new Date();
      const result: AnimeSyncResult = { inserted: 0, updated: 0, skipped: 0 };
      for (const input of inputs) {
        const outcome = await upsertOne(input, now);
        result[outcome] += 1;
      }
      return result;
    },
  };
}

export type AnimeSyncRepo = ReturnType<typeof animeSyncRepo>;

/** 同期対象フィールドに差分があるかを判定する（差分なし = 書き込みスキップ）。 */
function hasChanges(
  existing: Pick<
    typeof animeTitles.$inferSelect,
    | "sourceId"
    | "title"
    | "titleReading"
    | "titleEnglish"
    | "year"
    | "season"
    | "genres"
    | "thumbnailUrl"
  >,
  input: AnimeSyncInput,
): boolean {
  return (
    (input.sourceId ?? null) !== (existing.sourceId ?? null) ||
    input.title !== existing.title ||
    (input.titleReading ?? null) !== (existing.titleReading ?? null) ||
    (input.titleEnglish ?? null) !== (existing.titleEnglish ?? null) ||
    (input.year ?? null) !== (existing.year ?? null) ||
    (input.season ?? null) !== (existing.season ?? null) ||
    JSON.stringify(input.genres ?? null) !==
      JSON.stringify(existing.genres ?? null) ||
    (input.thumbnailUrl ?? null) !== (existing.thumbnailUrl ?? null)
  );
}
