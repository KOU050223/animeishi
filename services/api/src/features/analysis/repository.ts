import { eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { analyses } from "@/db/schema";
import type { Analysis } from "@/db/schema";
import { VALID_GENRES } from "../me/schema";

// ---- キャッシュ・レート制限のポリシー（issue #22）----
// Workers AI の呼び出しコストを抑えるため、結果を 24h キャッシュし、
// 生成実行はユーザーごとに固定窓で回数制限する。
// - キャッシュ: generated_at から TTL 内かつ input_hash が現在の履歴と
//   一致する場合だけ再利用する（履歴の変更＝ハッシュ不一致で自然に無効化）。
// - レート制限: window_started_at から 24h あたり generation_count 回まで。
//   窓が切れたら次の claim でカウンタを 1 にリセットする。
export const ANALYSIS_CACHE_TTL_SEC = 24 * 60 * 60;
export const ANALYSIS_RATE_LIMIT_WINDOW_SEC = 24 * 60 * 60;
export const ANALYSIS_MAX_GENERATIONS_PER_WINDOW = 5;

/**
 * 生成回数の上限に達したときに投げるエラー。
 * ルート層で 429 + Retry-After に変換する。
 */
export class AnalysisRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(
      "視聴傾向分析の実行回数が上限に達しました。しばらくしてから再度お試しください",
    );
    this.name = "AnalysisRateLimitError";
  }
}

/** 生成済みの分析結果（応答・キャッシュ判定の共通形）。 */
export type SavedAnalysis = {
  summary: string;
  recommendedGenres: string[];
  generatedAt: Date;
  workCount: number;
};

// claim 直後のプレースホルダ（結果カラムが NULL）は「未生成」として undefined。
function toSavedAnalysis(row: Analysis): SavedAnalysis | undefined {
  if (row.summary === null || row.genresJson === null) return undefined;
  if (row.generatedAt === null || row.workCount === null) return undefined;
  let genres: unknown;
  try {
    genres = JSON.parse(row.genresJson);
  } catch {
    genres = [];
  }
  const recommendedGenres = (Array.isArray(genres) ? genres : []).filter(
    (g): g is string => (VALID_GENRES as readonly string[]).includes(g),
  );
  return {
    summary: row.summary,
    recommendedGenres,
    generatedAt: row.generatedAt,
    workCount: row.workCount,
  };
}

/**
 * analysisRepository: 認証済みユーザーIDを束縛した analyses ドメインの
 * リポジトリ層。他ユーザーのキャッシュ・カウンタを触れないよう、
 * 全クエリで user_id を固定する。
 */
export function analysisRepository(db: DrizzleDb, currentUserId: string) {
  return {
    /** 保存済みの最新分析結果。未生成（または claim 中）なら undefined。 */
    async getMyAnalysis(): Promise<SavedAnalysis | undefined> {
      const row = await db.query.analyses.findFirst({
        where: eq(analyses.userId, currentUserId),
      });
      return row ? toSavedAnalysis(row) : undefined;
    },

    /**
     * 現在の入力と一致する有効なキャッシュを返す。
     * input_hash 不一致（＝視聴履歴か選択ジャンルの変更）または TTL 切れなら
     * undefined を返し、呼び出し側は再生成に進む。
     */
    async findFreshCache(
      inputHash: string,
      nowSec: number,
    ): Promise<SavedAnalysis | undefined> {
      const row = await db.query.analyses.findFirst({
        where: eq(analyses.userId, currentUserId),
      });
      if (!row || row.generatedAt === null) return undefined;
      if (row.inputHash !== inputHash) return undefined;
      const generatedAtSec = Math.floor(row.generatedAt.getTime() / 1000);
      if (nowSec - generatedAtSec >= ANALYSIS_CACHE_TTL_SEC) return undefined;
      return toSavedAnalysis(row);
    },

    /**
     * 生成スロットを 1 つ確保する（原子的なレート制限カウンタ）。
     * 成功した場合、AI 生成の成否に関わらず 1 回消費した扱いにする
     * （失敗時に巻き戻すと障害中の AI への連打を止められないため）。
     *
     * reports の createReport と同じく、「確認してから書く」ではなく
     * 条件付きの単一 statement にして並行リクエストのすり抜けを防ぐ。
     * 行が無い or 窓切れ → INSERT/UPSERT で新しい窓を 1 から開始、
     * 窓内 → generation_count < 上限 の場合だけインクリメント。
     * @throws AnalysisRateLimitError 窓内の残スロットが無いとき
     */
    async claimGeneration(nowSec: number): Promise<void> {
      const windowStartThresholdSec = nowSec - ANALYSIS_RATE_LIMIT_WINDOW_SEC;

      // 行が無い・窓切れのケースを 1 ステートメントで処理する。
      // - 行なし: NOT EXISTS が真 → INSERT で新規窓（count=1）。
      // - 行あり・窓切れ: NOT EXISTS が真（新しい窓の行は存在しない）→
      //   INSERT が PK 衝突 → DO UPDATE ... WHERE 窓切れ が真 → リセット。
      // - 行あり・窓内: NOT EXISTS が偽 → 何もせず changes=0。
      const claimed = await db.run(sql`
        INSERT INTO ${analyses} (user_id, window_started_at, generation_count)
        SELECT ${currentUserId}, ${nowSec}, 1
        WHERE NOT EXISTS (
          SELECT 1 FROM ${analyses}
          WHERE user_id = ${currentUserId}
            AND window_started_at > ${windowStartThresholdSec}
        )
        ON CONFLICT(user_id) DO UPDATE SET
          window_started_at = ${nowSec},
          generation_count = 1
        WHERE ${analyses.windowStartedAt} <= ${windowStartThresholdSec}
      `);
      if (claimed.meta.changes > 0) return;

      // 行あり・窓内: 上限未満の場合だけ消費する。
      const incremented = await db.run(sql`
        UPDATE ${analyses}
        SET generation_count = generation_count + 1
        WHERE user_id = ${currentUserId}
          AND window_started_at > ${windowStartThresholdSec}
          AND generation_count < ${ANALYSIS_MAX_GENERATIONS_PER_WINDOW}
      `);
      if (incremented.meta.changes > 0) return;

      // 上限到達。窓の解放時刻（window_started_at + 24h）までの待ち時間を返す。
      const row = await db.query.analyses.findFirst({
        where: eq(analyses.userId, currentUserId),
        columns: { windowStartedAt: true },
      });
      const waitSec = row
        ? Math.max(
            1,
            Math.floor(row.windowStartedAt.getTime() / 1000) +
              ANALYSIS_RATE_LIMIT_WINDOW_SEC -
              nowSec,
          )
        : ANALYSIS_RATE_LIMIT_WINDOW_SEC;
      throw new AnalysisRateLimitError(waitSec);
    },

    /** 生成完了後に結果を保存する。claim で作られた行へ上書きする。 */
    async saveMyAnalysis(data: {
      summary: string;
      recommendedGenres: string[];
      inputHash: string;
      workCount: number;
      generatedAt: Date;
    }): Promise<void> {
      await db
        .insert(analyses)
        .values({
          userId: currentUserId,
          summary: data.summary,
          genresJson: JSON.stringify(data.recommendedGenres),
          inputHash: data.inputHash,
          workCount: data.workCount,
          generatedAt: data.generatedAt,
          // 通常は claim で行が存在するが、並行してアカウント削除等で
          // 行が消えた経路でも書けるよう INSERT 側にも値を入れる。
          windowStartedAt: data.generatedAt,
          generationCount: 1,
        })
        .onConflictDoUpdate({
          target: analyses.userId,
          set: {
            summary: data.summary,
            genresJson: JSON.stringify(data.recommendedGenres),
            inputHash: data.inputHash,
            workCount: data.workCount,
            generatedAt: data.generatedAt,
          },
        });
    },
  };
}

export type AnalysisRepository = ReturnType<typeof analysisRepository>;
