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

// 記録されたインスタンス ID を「まだ存在しない＝起動中」とみなす猶予。
// 引き継ぎは create の前に次のインスタンス ID をジョブ行へ記録するため、
// 記録直後の一瞬だけ「ID はあるがインスタンスが無い」状態が正しい。
// その隙間で failed に倒すと引き継ぎ先が起動直後に止まってしまう。
const MISSING_INSTANCE_GRACE_MS = 60_000;
// 追跡列のない旧ジョブの「見えない引き継ぎ先」が止まったとみなす猶予。
// 生きていればアイテムの挿入・終了更新かジョブ行の更新で定期的に時刻が
// 進む。書き込みステップのタイムアウト（10 分）より長く取る。
const UNTRACKED_STALLED_GRACE_MS = 15 * 60_000;

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

/**
 * 実行中ジョブが本当に Workflow 側で生きているかを照合し、止まって
 * いるなら D1 側の状態を追従させる（issue #701）。ジョブが実行中のまま
 * インスタンスが errored / terminated / 消滅した状態を放置すると、
 * 実行中ジョブの部分一意インデックスで以後の新規作成が常に拒否され、
 * ユーザーが取り込みをやり直せなくなる。
 * 追跡するのは job.workflowInstanceId のインスタンス（引き継ぎ先を含む
 * 最新の実行主体）。未設定の旧ジョブは初回インスタンス（= job.id）を見る。
 * "settled" は D1 側を終了状態に書き換えたことを意味する。
 * 終了への書き換えは、照合で見たインスタンス ID が D1 の記録値とまだ
 * 一致するときだけ行う。照合がジョブ行を読んでからインスタンス状態を
 * 取るまでの間に引き継ぎが進むと、完了・消滅した旧インスタンスを見て
 * 生きているジョブを終了させてしまうため（Devin Review #702）。
 * 記録が進んでいて書き換えなかった場合は "running" を返す。
 */
async function reconcileJobWithWorkflow(
  repo: ReturnType<typeof episodeImportJobRepository>,
  binding: Workflow<DanimeEpisodeImportParams>,
  job: DanimeEpisodeImportJob,
): Promise<"running" | "settled"> {
  const instanceId = job.workflowInstanceId ?? job.id;
  // 追跡列があるジョブは、記録されたインスタンスが「最新」である前提で
  // 厳密に判定できる。無い旧ジョブは初回インスタンスしか見えず、
  // 引き継ぎ先が自動採番で動いている可能性を排除できないため緩く扱う。
  const tracked = job.workflowInstanceId != null;
  const settle = async (
    status: "completed" | "failed",
    error?: string,
  ): Promise<"running" | "settled"> =>
    (await repo.settleJobStatus(job.id, status, error, instanceId))
      ? "settled"
      : "running";
  // 追跡列のない旧ジョブが「見えない引き継ぎ先」でまだ動いているかを
  // 活動の新しさで判定する。引き継ぎの自動採番時代に作られた後続
  // インスタンスは ID を記録できず、こちらから状態を見られない。
  // 生きていればアイテムの挿入・終了更新かジョブ行の更新で定期的に
  // 時刻が進むため、最終活動が古いなら後続は止まっている（CodeRabbit
  // #702。新しいジョブは常に追跡されるためこの経路に来ない）。
  const untrackedActivityIsStale = async (): Promise<boolean> => {
    const itemAt = await repo.latestItemActivityAt(job.id);
    const lastActivityMs = Math.max(
      job.updatedAt.getTime(),
      itemAt?.getTime() ?? 0,
    );
    return Date.now() - lastActivityMs > UNTRACKED_STALLED_GRACE_MS;
  };
  const failIfMissing = async (): Promise<"running" | "settled"> => {
    // 記録されたインスタンスが存在しない。引き継ぎの「ID 記録 → create」
    // の隙間なら起動中であり、記録から時間が経っているなら create が
    // 失敗して止まっている（もしくはインスタンス状態が保持期限切れ）。
    if (tracked) {
      const ageMs = Date.now() - job.updatedAt.getTime();
      if (ageMs < MISSING_INSTANCE_GRACE_MS) return "running";
    } else if (!(await untrackedActivityIsStale())) {
      return "running";
    }
    return settle("failed", `workflow instance was lost: ${instanceId}`);
  };

  let st: InstanceStatus;
  try {
    st = await (await binding.get(instanceId)).status();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not.?found/i.test(message)) return failIfMissing();
    // 照合自体の一時的な失敗では D1 の値をそのまま使う（進捗を隠さない）。
    return "running";
  }

  if (st.status === "unknown") return failIfMissing();
  if (st.status === "errored" || st.status === "terminated") {
    // 初回インスタンスの死では原則後続は無い（後続は正常終了の直前に
    // だけ作られる）が、create 成功後にステップが落ちた稀なケースでは
    // 追跡列のない旧ジョブの見えない後続が生きている可能性がある。
    if (!tracked && !(await untrackedActivityIsStale())) return "running";
    return settle("failed", st.error?.message ?? `workflow ${st.status}`);
  }
  if (st.status === "complete") {
    // 予算・ステップ上限の引き継ぎで正常終了した元インスタンスも
    // complete になる（引き継ぎ先は別インスタンス ID で動く）。
    // 後続が残りを処理中なのに完了扱いすると、引き継ぎ先の
    // load-job が終了済みと判定して止まり残りの話が記録されない
    // （issue #695 の引き継ぎ経路）。完了に追従するのは
    // 書き込みフェーズで pending が残っていないときだけ。
    const [pending] = await repo.listPendingItems(job.id, 1);
    if (job.status === "writing" && !pending) {
      return settle("completed");
    }
    // 追跡対象のインスタンスが後続を残さず完了したのにジョブが
    // 実行中のままなら、処理を引き継ぐ先の無い行き止まり。
    if (tracked) {
      return settle(
        "failed",
        `workflow instance completed while the job is still ${job.status}`,
      );
    }
    // 追跡列のない旧ジョブでは、正常終了した初回インスタンスの
    // 自動採番の後続が見えない。生きていればアイテム・ジョブ行が
    // 定期的に更新されるため、最終活動が古いなら後続は止まっている
    // とみなして failed にし、新規作成できるようにする（CodeRabbit
    // #702）。活動が新しい間は後続が処理中として何もしない。
    if (await untrackedActivityIsStale()) {
      return settle(
        "failed",
        `untracked workflow successor appears stalled (instance ${instanceId} completed)`,
      );
    }
  }
  return "running";
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
        // 実行中に見えるジョブのインスタンスが実は止まっているなら、
        // ここで終了させて新規作成に進む（issue #701）。
        // そうでなければ既存ジョブをそのまま返す。
        const settled = DANIME_EPISODE_IMPORT
          ? (await reconcileJobWithWorkflow(
              repo,
              DANIME_EPISODE_IMPORT,
              running,
            )) === "settled"
          : false;
        if (!settled) {
          return c.json({ job: toJobDto(running), created: false }, 200);
        }
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
      try {
        await repo.createJob(jobId, userId);
      } catch (err) {
        // 実行中ジョブの部分一意インデックスに当たった側はここで落ちる。
        // 先に作られたジョブを返して既存進捗を見せる（同時 POST 競合）。
        const concurrent = await repo.getRunningJobForUser(userId);
        if (concurrent) {
          return c.json({ job: toJobDto(concurrent), created: false }, 200);
        }
        throw err;
      }
      try {
        await repo.insertJobWorks(
          works.map((w) => ({
            jobId,
            danimeWorkId: w.danimeWorkId,
            annictWorkId: w.annictWorkId,
            episodesJson: JSON.stringify(w.episodes),
          })),
        );
        await DANIME_EPISODE_IMPORT.create({
          id: jobId,
          params: { jobId, userId },
        });
      } catch (err) {
        // 入力保存・Workflow 起動の失敗時に matching のまま残ると、
        // 以後の POST がこのジョブを返し続けて取り込めなくなる。
        // 実行中扱いを外すため failed に倒してから投げ直す。
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
      const settled =
        (await reconcileJobWithWorkflow(repo, DANIME_EPISODE_IMPORT, job)) ===
        "settled";
      if (settled) {
        const updated = await repo.getJob(job.id);
        return c.json({ job: updated ? toJobDto(updated) : null }, 200);
      }
    }
    return c.json({ job: toJobDto(job) }, 200);
  });
