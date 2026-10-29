import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthVariables } from "@/middleware/auth";
import { createDb } from "@/db/client";
import { createOpenApiApp } from "@/lib/openapi";
import { reportApiFailure } from "@/observability";
import { watchHistoryRepository } from "../watch-history/repository";
import { usersRepository } from "../users/repository";
import {
  analysisRepository,
  AnalysisRateLimitError,
  type SavedAnalysis,
} from "./repository";
import {
  recommendationRepository,
  RecommendationRateLimitError,
  type RecommendedWork,
  type SavedRecommendation,
} from "./recommendationRepository";
import {
  matchCandidateWorks,
  runRecommendationCandidates,
  toRecommendedWork,
} from "./recommendationService";
import type { RecommendationCandidate } from "./recommendationService";
import { buildAnalysisInput, computeInputHash, runAnalysis } from "./service";
import {
  generateAnalysisRoute,
  generateRecommendationsRoute,
  getAnalysisRoute,
  getRecommendationsRoute,
} from "./schema";
import { resolveAnnictToken } from "@/lib/annict/middleware";
import { currentAnnictSeason } from "@/lib/annict/client";
import { workImageUrl } from "@/lib/annict/workImage";
import { worksRepository } from "../works/repository";
import { attachResolvedImages } from "../works/service";

// POST /me/analysis が必要とするバインディング。AI は wrangler.toml の
// [ai] binding = "AI"（preview / production 双方に定義済み）。
function getBindings(c: Context): { DB: D1Database; AI: Ai } {
  return c.env as { DB: D1Database; AI: Ai };
}

function toResponse(saved: SavedAnalysis) {
  return {
    summary: saved.summary,
    recommendedGenres: saved.recommendedGenres,
    generatedAt: saved.generatedAt.toISOString(),
    workCount: saved.workCount,
  };
}

// 保存済みおすすめの応答形へ変換する。hostedImageUrl は保存せず毎回
// 画像プロキシ URL から組み立てる（ドメイン依存値のため DB に入れない。
// /works/search の検索応答と同じ考え方）。
function toRecommendationResponse(
  requestUrl: string,
  saved: SavedRecommendation,
) {
  return {
    works: saved.works.map((w) => ({
      ...w,
      hostedImageUrl: workImageUrl(requestUrl, w.annictWorkId),
    })),
    generatedAt: saved.generatedAt.toISOString(),
  };
}

// 視聴傾向分析（issue #22）。旧 Gemini 版（POST /analysis/gemini）の移植を
// Workers AI 前提に読み替え、feature 構成で実装する。
// 入力は D1 にキャッシュ済みの watch_history（Annict read-through 済みの
// スナップショット）。Annict トークンは不要（API が外部へ再取得しない）。
const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
const analysis = app
  .openapi(getAnalysisRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const saved = await analysisRepository(
      db,
      c.var.clerkUserId,
    ).getMyAnalysis();
    return c.json({ analysis: saved ? toResponse(saved) : null }, 200);
  })
  .openapi(generateAnalysisRoute, async (c) => {
    const env = getBindings(c);
    const db = createDb(env.DB);
    const userId = c.var.clerkUserId;

    const history = await watchHistoryRepository(
      db,
      userId,
    ).getMyWatchHistory();
    if (history.length === 0) {
      return c.json(
        {
          error:
            "分析するには視聴履歴が必要です。まず Annict と連携して作品を記録してください",
        },
        400,
      );
    }

    const selectedGenres = await usersRepository(db, userId).getMyGenres();
    const input = buildAnalysisInput(history, selectedGenres);
    const inputHash = await computeInputHash(input);

    const repo = analysisRepository(db, userId);
    const nowSec = Math.floor(Date.now() / 1000);

    // 入力が同一で TTL 内ならキャッシュを返す（視聴履歴の変更＝ハッシュ不一致
    // はここで自動的に無効化される）。
    const cached = await repo.findFreshCache(inputHash, nowSec);
    if (cached) {
      return c.json({ analysis: toResponse(cached), cached: true }, 200);
    }

    // 生成回数制限。claim はカウンタを原子的に消費する（AI 呼び出しが
    // 失敗しても 1 回消費した扱い。障害中の連打防止のため）。
    // 同時に行を「この入力ハッシュで生成中」にマークする。
    try {
      await repo.claimGeneration(nowSec, inputHash);
    } catch (e) {
      if (e instanceof AnalysisRateLimitError) {
        c.header("Retry-After", String(e.retryAfterSeconds));
        return c.json(
          { error: e.message, code: "generation_limit" as const },
          429,
        );
      }
      throw e;
    }

    let output: Awaited<ReturnType<typeof runAnalysis>>;
    try {
      output = await runAnalysis(env.AI, input);
    } catch (e) {
      // Workers AI の障害・応答解釈失敗。上流起因のため 502 にし、
      // Sentry・Discord へは明示的に送る。
      reportApiFailure(e, c, 502);
      return c.json(
        {
          error: "視聴傾向の分析に失敗しました。時間をおいて再度お試しください",
        },
        502,
      );
    }

    const saved: SavedAnalysis = {
      ...output,
      generatedAt: new Date(),
      workCount: input.totalCount,
    };
    // claim 後に別入力の生成が先行した場合は保存を破棄する（古い結果が
    // 新しい結果を上書きしないよう compare-and-swap）。
    const persisted = await repo.saveMyAnalysis({ ...saved, inputHash });
    if (!persisted) {
      const current = await repo.getMyAnalysis();
      if (current) {
        return c.json({ analysis: toResponse(current), cached: true }, 200);
      }
      // 先行した生成がまだ完了していない。今回の結果は保存しないが
      // 応答としては返す（次回 POST で正規の結果が保存される）。
    }
    return c.json({ analysis: toResponse(saved), cached: false }, 200);
  })
  .openapi(getRecommendationsRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const saved = await recommendationRepository(
      db,
      c.var.clerkUserId,
    ).getMyRecommendations();
    return c.json(
      {
        recommendations: saved
          ? toRecommendationResponse(c.req.url, saved)
          : null,
      },
      200,
    );
  })
  // AI おすすめ生成（issue #335）。分析と同じ入力（履歴＋選択ジャンル）で
  // キャッシュ・レート制限を行い、AI の候補を Annict searchWorks で照合し、
  // 本人の履歴に無い作品だけを返す。
  .openapi(generateRecommendationsRoute, async (c) => {
    const env = getBindings(c);
    const db = createDb(env.DB);
    const userId = c.var.clerkUserId;

    const history = await watchHistoryRepository(
      db,
      userId,
    ).getMyWatchHistory();
    if (history.length === 0) {
      return c.json(
        {
          error:
            "おすすめには視聴履歴が必要です。まず Annict と連携して作品を記録してください",
        },
        400,
      );
    }

    const selectedGenres = await usersRepository(db, userId).getMyGenres();
    const input = buildAnalysisInput(history, selectedGenres);
    const inputHash = await computeInputHash(input);

    const repo = recommendationRepository(db, userId);
    const nowSec = Math.floor(Date.now() / 1000);

    // キャッシュヒット時は Annict も AI も呼ばず保存済みを返す。
    const cached = await repo.findFreshCache(inputHash, nowSec);
    if (cached) {
      return c.json(
        {
          recommendations: toRecommendationResponse(c.req.url, cached),
          cached: true,
        },
        200,
      );
    }

    // Annict searchWorks で照合するためトークンが必要。
    // 未連携は claim 前に 401 で弾く（生成枠を消費させない）。
    const annictToken = await resolveAnnictToken(c);
    if (!annictToken) {
      return c.json(
        { error: "Annict 連携が必要です", code: "annict_token_required" },
        401,
      );
    }

    // 生成回数制限。claim の意味づけは分析と同じ（失敗も 1 回消費）。
    try {
      await repo.claimGeneration(nowSec, inputHash);
    } catch (e) {
      if (e instanceof RecommendationRateLimitError) {
        c.header("Retry-After", String(e.retryAfterSeconds));
        return c.json(
          { error: e.message, code: "generation_limit" as const },
          429,
        );
      }
      throw e;
    }

    // 保存済みの分析結果があれば傾向としてプロンプトに載せる。
    const savedAnalysis = await analysisRepository(db, userId).getMyAnalysis();

    let candidates: RecommendationCandidate[];
    try {
      candidates = await runRecommendationCandidates(env.AI, input, {
        currentSeason: currentAnnictSeason(),
        analysis: savedAnalysis,
      });
    } catch (e) {
      reportApiFailure(e, c, 502);
      return c.json(
        {
          error: "おすすめの生成に失敗しました。時間をおいて再度お試しください",
        },
        502,
      );
    }

    // AnnictApiError（トークン失効・上流障害）はそのまま throw し、
    // app.onError の handleError が 401/502 に変換する。
    const matched = await matchCandidateWorks(
      annictToken,
      candidates,
      new Set(history.map((h) => h.annictWorkId)),
    );
    const works: RecommendedWork[] = matched.map((m) =>
      toRecommendedWork(m.work, m.reason),
    );

    // 検索応答と同じく、見せる作品は annict_works にキャッシュして画像
    // プロキシ URL を載せる（WANNA_WATCH 登録時の nodeId 解決にも使う）。
    const enriched = await attachResolvedImages(
      worksRepository(db),
      matched.map((m) => m.work),
      c.req.url,
    );
    const hostedImageById = new Map(
      enriched.map((w) => [w.annictWorkId, w.hostedImageUrl]),
    );

    const generatedAt = new Date();
    const persisted = await repo.saveMyRecommendations({
      works,
      inputHash,
      generatedAt,
    });
    if (!persisted) {
      const current = await repo.getMyRecommendations();
      if (current) {
        return c.json(
          {
            recommendations: toRecommendationResponse(c.req.url, current),
            cached: true,
          },
          200,
        );
      }
    }
    return c.json(
      {
        recommendations: {
          works: works.map((w) => ({
            ...w,
            hostedImageUrl: hostedImageById.get(w.annictWorkId) ?? null,
          })),
          generatedAt: generatedAt.toISOString(),
        },
        cached: false,
      },
      200,
    );
  });

export { analysis };
