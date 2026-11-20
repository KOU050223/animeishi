// dアニメ話記録ジョブの登録・進捗参照ルート（issue #477）。
//
// POST は実行中ジョブが無いことを確認し、ジョブ行＋入力行（対象作品と
// dアニメ話一覧）を D1 に登録して Workflow インスタンスを起動し、即座に
// 返す。ユーザーはそのまま画面を閉じてよい（書き込みはバックグラウンド）。
// Annict トークンは Workflow 側でユーザー ID から復号するため、ここでは
// Web 連携（D1 保存トークン）の有無だけを確認する。
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createDb } from "@/db/client";
import { requireAuth } from "@/middleware/auth";
import type { AuthVariables } from "@/middleware/auth";
import { annictRepository } from "../annict/repository";
import type { DanimeEpisodeImportJob } from "@/db/schema";
import { danimeEpisodeJobCreateSchema } from "./schema";
import { episodeImportJobRepository, RUNNING_JOB_STATUSES } from "./repository";
import type { DanimeEpisodeImportParams } from "./episodeImportWorkflow";

type EpisodeJobBindings = {
  DB: D1Database;
  DANIME_EPISODE_IMPORT?: Workflow<DanimeEpisodeImportParams>;
};

function toJobDto(job: DanimeEpisodeImportJob) {
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    failed: job.failed,
    skipped: job.skipped,
    unmatched: job.unmatched,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export const danimeEpisodeJobs = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .post(
    "/episode-jobs",
    zValidator("json", danimeEpisodeJobCreateSchema),
    async (c) => {
      const userId = c.get("clerkUserId");
      const { works } = c.req.valid("json");
      const { DB, DANIME_EPISODE_IMPORT } = c.env as EpisodeJobBindings;
      const db = createDb(DB);
      const repo = episodeImportJobRepository(db);

      // 同時に 1 ジョブだけ。実行中があれば新規作成せず既存を返す
      // （画面は返ってきたジョブの進捗をそのまま表示する）。
      const running = await repo.getRunningJobForUser(userId);
      if (running) {
        return c.json({ job: toJobDto(running), created: false }, 200);
      }

      // Workflow は D1 保存の暗号化トークンしか使えない。ヘッダ方式の
      // ネイティブ利用者はここで弾く（ジョブを作ってもトークン解決で
      // 必ず失敗するため、作成時点で分かりやすく失敗にする）。
      const tokenRow = await annictRepository(db, userId).getAnnictTokenRow();
      if (!tokenRow) {
        return c.json(
          {
            error: "話数記録には Web の Annict 連携が必要です",
            code: "annict_token_required",
          },
          401,
        );
      }
      if (!DANIME_EPISODE_IMPORT) {
        return c.json(
          { error: "話数記録のバックグラウンド処理が利用できません" },
          503,
        );
      }

      const jobId = crypto.randomUUID();
      await repo.createJob(jobId, userId);
      await repo.insertJobWorks(
        works.map((w) => ({
          jobId,
          danimeWorkId: w.danimeWorkId,
          annictWorkId: w.annictWorkId,
          episodesJson: JSON.stringify(w.episodes),
        })),
      );
      try {
        await DANIME_EPISODE_IMPORT.create({
          id: jobId,
          params: { jobId, userId },
        });
      } catch (err) {
        // Workflow 起動自体に失敗したら実行中ジョブが残って以後の
        // 作成を塞がないよう failed に倒してから投げ直す。
        await repo.setJobStatus(
          jobId,
          "failed",
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      }
      const job = await repo.getJob(jobId);
      return c.json({ job: job ? toJobDto(job) : null, created: true }, 201);
    },
  )
  .get("/episode-jobs/current", async (c) => {
    const userId = c.get("clerkUserId");
    const { DB, DANIME_EPISODE_IMPORT } = c.env as EpisodeJobBindings;
    const db = createDb(DB);
    const repo = episodeImportJobRepository(db);
    const job = await repo.getLatestJobForUser(userId);
    if (!job) return c.json({ job: null }, 200);

    // 実行中のまま Workflow インスタンス側が終わっている（errored /
    // terminated / complete）場合は D1 側の状態を追従させる。
    // binding の無い環境（一部のテスト・ローカル）ではこの照合を飛ばす。
    if (RUNNING_JOB_STATUSES.includes(job.status) && DANIME_EPISODE_IMPORT) {
      try {
        const inst = await DANIME_EPISODE_IMPORT.get(job.id);
        const st = await inst.status();
        if (st.status === "errored" || st.status === "terminated") {
          await repo.setJobStatus(
            job.id,
            "failed",
            st.error?.message ?? "workflow terminated",
          );
        } else if (st.status === "complete") {
          await repo.setJobStatus(job.id, "completed");
        } else {
          return c.json({ job: toJobDto(job) }, 200);
        }
        const updated = await repo.getJob(job.id);
        return c.json({ job: updated ? toJobDto(updated) : null }, 200);
      } catch {
        // インスタンス照合の失敗は D1 の値をそのまま返す
        // （照合不能で進捗を隠さない）。
      }
    }
    return c.json({ job: toJobDto(job) }, 200);
  });
