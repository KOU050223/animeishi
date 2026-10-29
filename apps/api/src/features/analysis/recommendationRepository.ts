import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DrizzleDb } from "@/db/client";
import { recommendations } from "@/db/schema";
import type { Recommendation } from "@/db/schema";

// ---- キャッシュ・レート制限のポリシー（issue #335。analyses と同じ考え方）----
// Workers AI の呼び出しコストを抑えるため、結果を 24h キャッシュし、
// 生成実行はユーザーごとに固定窓で回数制限する。
// - キャッシュ: generated_at から TTL 内かつ input_hash が現在の履歴と
//   一致する場合だけ再利用する（履歴の変更＝ハッシュ不一致で自然に無効化）。
// - レート制限: window_started_at から 24h あたり generation_count 回まで。
//   窓が切れたら次の claim でカウンタを 1 にリセットする。
export const RECOMMENDATION_CACHE_TTL_SEC = 24 * 60 * 60;
export const RECOMMENDATION_RATE_LIMIT_WINDOW_SEC = 24 * 60 * 60;
export const RECOMMENDATION_MAX_GENERATIONS_PER_WINDOW = 5;

/**
 * 生成回数の上限に達したときに投げるエラー。
 * ルート層で 429 + Retry-After に変換する。
 */
export class RecommendationRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(
      "おすすめ生成の実行回数が上限に達しました。しばらくしてから再度お試しください",
    );
    this.name = "RecommendationRateLimitError";
  }
}

/** おすすめ 1 作品（works_json に保存する形）。 */
export type RecommendedWork = {
  annictWorkId: number;
  title: string;
  titleKana: string | null;
  titleEn: string | null;
  seasonName: string | null;
  seasonYear: number | null;
  /** AI が生成したおすすめ理由（日本語）。空なら UI は理由を表示しない。 */
  reason: string;
};

/** 生成済みのおすすめ結果（応答・キャッシュ判定の共通形）。 */
export type SavedRecommendation = {
  works: RecommendedWork[];
  generatedAt: Date;
};

// works_json の保存形。DB に書き込む前に必ずこの形で直列化するが、
// 読み出し側も手を抜かず検証する（旧形式・破損行への防御）。
const recommendedWorkSchema = z.object({
  annictWorkId: z.number().int().positive(),
  title: z.string().min(1),
  titleKana: z.string().nullable(),
  titleEn: z.string().nullable(),
  seasonName: z.string().nullable(),
  seasonYear: z.number().int().nullable(),
  reason: z.string(),
});

// claim 直後のプレースホルダ（works_json が NULL）は「未生成」として undefined。
function toSavedRecommendation(
  row: Recommendation,
): SavedRecommendation | undefined {
  if (row.worksJson === null || row.generatedAt === null) return undefined;
  let works: unknown;
  try {
    works = JSON.parse(row.worksJson);
  } catch {
    works = [];
  }
  const parsed = z.array(recommendedWorkSchema).safeParse(works);
  return {
    works: parsed.success ? parsed.data : [],
    generatedAt: row.generatedAt,
  };
}

/**
 * recommendationRepository: 認証済みユーザーIDを束縛した recommendations
 * ドメインのリポジトリ層。他ユーザーのキャッシュ・カウンタを触れないよう、
 * 全クエリで user_id を固定する。claim / compare-and-swap の構造は
 * analysisRepository と同じ。
 */
export function recommendationRepository(db: DrizzleDb, currentUserId: string) {
  return {
    /** 保存済みの最新おすすめ結果。未生成（または claim 中）なら undefined。 */
    async getMyRecommendations(): Promise<SavedRecommendation | undefined> {
      const row = await db.query.recommendations.findFirst({
        where: eq(recommendations.userId, currentUserId),
      });
      return row ? toSavedRecommendation(row) : undefined;
    },

    /**
     * 現在の入力と一致する有効なキャッシュを返す。
     * input_hash 不一致（＝視聴履歴か選択ジャンルの変更）または TTL 切れなら
     * undefined を返し、呼び出し側は再生成に進む。
     */
    async findFreshCache(
      inputHash: string,
      nowSec: number,
    ): Promise<SavedRecommendation | undefined> {
      const row = await db.query.recommendations.findFirst({
        where: eq(recommendations.userId, currentUserId),
      });
      if (!row || row.generatedAt === null) return undefined;
      if (row.inputHash !== inputHash) return undefined;
      const generatedAtSec = Math.floor(row.generatedAt.getTime() / 1000);
      if (nowSec - generatedAtSec >= RECOMMENDATION_CACHE_TTL_SEC)
        return undefined;
      return toSavedRecommendation(row);
    },

    /**
     * 生成スロットを 1 つ確保する（原子的なレート制限カウンタ）。
     * 成功した場合、AI 生成の成否に関わらず 1 回消費した扱いにする
     * （失敗時に巻き戻すと障害中の AI への連打を止められないため）。
     * 構造は analysisRepository.claimGeneration と同じ（生成中マークで
     * 先行生成との compare-and-swap を成立させる）。
     * @throws RecommendationRateLimitError 窓内の残スロットが無いとき
     */
    async claimGeneration(nowSec: number, inputHash: string): Promise<void> {
      const windowStartThresholdSec =
        nowSec - RECOMMENDATION_RATE_LIMIT_WINDOW_SEC;

      const claimed = await db.run(sql`
        INSERT INTO ${recommendations} (user_id, window_started_at, generation_count, input_hash)
        SELECT ${currentUserId}, ${nowSec}, 1, ${inputHash}
        WHERE NOT EXISTS (
          SELECT 1 FROM ${recommendations}
          WHERE user_id = ${currentUserId}
            AND window_started_at > ${windowStartThresholdSec}
        )
        ON CONFLICT(user_id) DO UPDATE SET
          window_started_at = ${nowSec},
          generation_count = 1,
          input_hash = ${inputHash},
          works_json = NULL,
          generated_at = NULL
        WHERE ${recommendations.windowStartedAt} <= ${windowStartThresholdSec}
      `);
      if (claimed.meta.changes > 0) return;

      const incremented = await db.run(sql`
        UPDATE ${recommendations}
        SET generation_count = generation_count + 1,
          input_hash = ${inputHash},
          works_json = NULL,
          generated_at = NULL
        WHERE user_id = ${currentUserId}
          AND window_started_at > ${windowStartThresholdSec}
          AND generation_count < ${RECOMMENDATION_MAX_GENERATIONS_PER_WINDOW}
      `);
      if (incremented.meta.changes > 0) return;

      const row = await db.query.recommendations.findFirst({
        where: eq(recommendations.userId, currentUserId),
        columns: { windowStartedAt: true },
      });
      const waitSec = row
        ? Math.max(
            1,
            Math.floor(row.windowStartedAt.getTime() / 1000) +
              RECOMMENDATION_RATE_LIMIT_WINDOW_SEC -
              nowSec,
          )
        : RECOMMENDATION_RATE_LIMIT_WINDOW_SEC;
      throw new RecommendationRateLimitError(waitSec);
    },

    /**
     * 生成完了後に結果を保存する。
     * claim が書き込んだ input_hash と一致する場合だけ上書きする
     * （compare-and-swap）。自分の生成中に新しい入力の生成が先行した
     * 場合は false を返し、古い結果での上書きを破棄する。
     */
    async saveMyRecommendations(data: {
      works: RecommendedWork[];
      inputHash: string;
      generatedAt: Date;
    }): Promise<boolean> {
      const result = await db.run(sql`
        UPDATE ${recommendations}
        SET works_json = ${JSON.stringify(data.works)},
          generated_at = ${Math.floor(data.generatedAt.getTime() / 1000)}
        WHERE user_id = ${currentUserId}
          AND input_hash = ${data.inputHash}
      `);
      return result.meta.changes > 0;
    },
  };
}

export type RecommendationRepository = ReturnType<
  typeof recommendationRepository
>;
