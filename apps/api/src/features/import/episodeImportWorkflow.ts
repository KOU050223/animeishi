// dアニメ話記録ジョブを実行する Cloudflare Workflow（issue #477）。
//
// POST /me/import/danime/episode-jobs がジョブ行＋入力行を D1 に登録して
// 即座に返し、こちらがバックグラウンドで
//   1. 作品ごとに Annict 話一覧を引いて dアニメ話と対応付け（2 方式以上一致のみ確定）
//   2. 確定した話を約 1 秒間隔で createRecord
// を行う。ユーザーは画面を閉じてよい。
//
// 再開可能性: 各ステップは D1 のアイテム表の pending 行だけを読むため、
// インスタンスが途中で落ちても書き込み済みの話を再送しない。
// トークンはパラメータに載せず、Workflow 内で userId → D1 暗号化トークンを
// 都度復号する（平文を Workflow のイベントに残さない）。
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { createDb } from "@/db/client";
import type { DrizzleDb } from "@/db/client";
import type { DanimeEpisodeImportWork } from "@/db/schema";
import { annictRepository } from "@/features/annict/repository";
import { decryptToken } from "@/lib/annict/crypto";
import {
  AnnictApiError,
  createAnnictRecord,
  fetchAnnictWorkEpisodes,
  fetchAnnictWorksEpisodesBatch,
} from "@/lib/annict/client";
import type { AnnictWorkEpisode } from "@/lib/annict/client";
import { worksRepository } from "@/features/works/repository";
import { episodeRecordsRepository } from "@/features/episode-records/repository";
import { ensureAnnictWork } from "@/features/episode-records";
import {
  matchDanimeWorkEpisodes,
  type DanimeExtractedEpisode,
} from "@animeishi/danime-core";
import { episodeImportJobRepository } from "./repository";

export type DanimeEpisodeImportWorkflowEnv = {
  DB: D1Database;
  ANNICT_ENCRYPTION_KEY?: string;
};

// Workflow パラメータには識別子だけを載せる。話一覧（大きい）と
// Annict トークン（平文）は載せない。
export type DanimeEpisodeImportParams = { jobId: string; userId: string };

// 話対応付け 1 ステップあたりの作品数。バッチ話一覧取得（searchWorks 最大
// 50 件）で 1 リクエストにまとまる範囲に収める。
const MATCH_WORK_CHUNK = 25;
// 書き込み 1 ステップあたりの話数。約 1.1 秒間隔 × 8 件 ≈ 9 秒/ステップ。
const WRITE_CHUNK = 8;
// createRecord の間隔。Annict のレート制限を避けるため 1 秒強を空ける。
const WRITE_INTERVAL_MS = 1_100;
// 429 を受けたときの待ち時間（Annict のレート窓は分単位）。
const RATE_LIMIT_WAIT_MS = 30_000;
// 429 以外の一時障害（0/5xx）のリトライ待ち。
const TRANSIENT_RETRY_WAIT_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Annict の応答がリトライ可能な一時障害か（annict/retry.ts の分類と同じ）。
function isRetriable(err: unknown): boolean {
  return (
    err instanceof AnnictApiError &&
    (err.status === 429 || err.status === 0 || err.status >= 500)
  );
}

// episodesJson を対応付け入力に戻す。壊れた JSON は「話なし」に潰さず
// ステップを失敗させてリトライに回す（データ不整合を黙認しない）。
function parseJobWorkEpisodes(
  row: DanimeEpisodeImportWork,
): DanimeExtractedEpisode[] {
  const raw = JSON.parse(row.episodesJson) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (
        e,
      ): e is {
        partId: string;
        watched?: boolean;
        label?: string;
        subtitle?: string;
      } =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as { partId?: unknown }).partId === "string",
    )
    .map((e) => ({
      partId: e.partId,
      // 視聴済みの話だけが対応付け対象。watched 欠落は未視聴扱い。
      watched: e.watched === true,
      label: typeof e.label === "string" ? e.label : "",
      subtitle: typeof e.subtitle === "string" ? e.subtitle : "",
    }));
}

export class DanimeEpisodeImportWorkflow extends WorkflowEntrypoint<
  DanimeEpisodeImportWorkflowEnv,
  DanimeEpisodeImportParams
> {
  async run(
    event: Readonly<WorkflowEvent<DanimeEpisodeImportParams>>,
    step: WorkflowStep,
  ): Promise<void> {
    const { jobId, userId } = event.payload;
    const db = createDb(this.env.DB);
    const repo = episodeImportJobRepository(db);

    try {
      // トークンはジョブ所有ユーザーの D1 保存分を復号する。Web 連携前提
      // （ヘッダ方式のネイティブ利用者は API 側で先に弾く）。
      const token = await step.do("resolve-token", async () => {
        const key = this.env.ANNICT_ENCRYPTION_KEY;
        const row = await annictRepository(db, userId).getAnnictTokenRow();
        if (!key || !row) {
          throw new NonRetryableError(
            "annict token is not stored for the job owner",
          );
        }
        try {
          return await decryptToken(row.encryptedToken, key);
        } catch {
          throw new NonRetryableError("annict token decrypt failed");
        }
      });

      const works = await step.do("load-input", () => repo.listJobWorks(jobId));

      // 対応付けフェーズ。作品をチャンクに分けて 1 チャンク = 1 ステップ。
      for (let i = 0; i < works.length; i += MATCH_WORK_CHUNK) {
        const chunk = works.slice(i, i + MATCH_WORK_CHUNK);
        const result = await step.do(
          `match-${i}`,
          { retries: { limit: 2, delay: "10 seconds" } },
          () => this.matchChunk(db, repo, jobId, token, chunk),
        );
        await step.do(`match-count-${i}`, () =>
          repo.updateJobProgress(jobId, {
            total: result.planned,
            skipped: result.skipped,
            unmatched: result.unmatched,
          }),
        );
      }

      await step.do("begin-writing", () => repo.setJobStatus(jobId, "writing"));

      // 書き込みフェーズ。pending アイテムを先頭から取って書き込み、
      // 無くなるまで繰り返す。ステップがリトライしても pending だけを
      // 読むので書き込み済みの話を再送しない。
      let batch = 0;
      while (
        (await step.do(
          `write-${batch++}`,
          {
            retries: { limit: 2, delay: "30 seconds" },
            timeout: "10 minutes",
          },
          () => this.writeChunk(db, repo, jobId, userId, token),
        )) > 0
      ) {
        // pending が無くなるまで続ける
      }

      await step.do("finish", () => repo.setJobStatus(jobId, "completed"));
    } catch (err) {
      // 失敗の記録は best-effort（D1 自体の障害なら記録も失敗し得る）。
      try {
        await repo.setJobStatus(jobId, "failed", errorMessage(err));
      } catch {
        // 記録自体の失敗は握る（Workflow のエラーとしては残る）。
      }
      throw err;
    }
  }

  /**
   * 対応付け 1 チャンク: Annict 話一覧をバッチ取得 → dアニメ話と対応付け →
   * 確定分をアイテム表に登録。記録済み（viewerDidTrack）は skipped。
   */
  private async matchChunk(
    db: DrizzleDb,
    repo: ReturnType<typeof episodeImportJobRepository>,
    jobId: string,
    token: string,
    chunk: DanimeEpisodeImportWork[],
  ): Promise<{ planned: number; skipped: number; unmatched: number }> {
    const batch = await fetchAnnictWorksEpisodesBatch(
      token,
      chunk.map((w) => w.annictWorkId),
    );
    const episodesByWork = new Map(batch.map((b) => [b.annictWorkId, b]));

    // バッチ結果に無い作品・50 話超の作品は個別取得で補う。
    for (const work of chunk) {
      const hit = episodesByWork.get(work.annictWorkId);
      if (hit && !hit.hasMoreEpisodes) continue;
      const episodes = await fetchAnnictWorkEpisodes(token, work.annictWorkId);
      episodesByWork.set(work.annictWorkId, {
        annictWorkId: work.annictWorkId,
        episodes: episodes ?? [],
        hasMoreEpisodes: false,
      });
    }

    let planned = 0;
    let skipped = 0;
    let unmatched = 0;
    const items: Parameters<typeof repo.insertJobItems>[0] = [];
    for (const work of chunk) {
      const annictEps: AnnictWorkEpisode[] =
        episodesByWork.get(work.annictWorkId)?.episodes ?? [];
      const watched = parseJobWorkEpisodes(work).filter((e) => e.watched);
      if (watched.length === 0) continue;
      const res = matchDanimeWorkEpisodes(
        watched.map(({ partId, label, subtitle }) => ({
          partId,
          label,
          subtitle,
        })),
        annictEps,
      );
      const tracked = new Map(
        annictEps.map((e) => [e.annictEpisodeId, e.viewerDidTrack]),
      );
      for (const m of res.matched) {
        // Annict に記録済みの話は書かない（事前突き合わせ）。
        const status = tracked.get(m.annictEpisodeId) ? "skipped" : "pending";
        if (status === "skipped") skipped++;
        else planned++;
        items.push({
          jobId,
          annictWorkId: work.annictWorkId,
          annictEpisodeId: m.annictEpisodeId,
          episodeNodeId: m.episodeNodeId,
          status,
        });
      }
      unmatched += res.unresolved.length;
    }
    await repo.insertJobItems(items);
    return { planned, skipped, unmatched };
  }

  /**
   * 書き込み 1 チャンク: pending を WRITE_CHUNK 件だけ取り、約 1 秒間隔で
   * createRecord。戻り値は処理件数（0 で終了判定に使う）。
   */
  private async writeChunk(
    db: DrizzleDb,
    repo: ReturnType<typeof episodeImportJobRepository>,
    jobId: string,
    userId: string,
    token: string,
  ): Promise<number> {
    const items = await repo.listPendingItems(jobId, WRITE_CHUNK);
    if (items.length === 0) return 0;

    const worksRepo = worksRepository(db);
    const recordsRepo = episodeRecordsRepository(db, userId);
    // episode_records の annict_works FK 用にキャッシュを保証する。
    // 同じ作品が連続するため 1 ステップ内では解決済みを覚えて使い回す。
    const ensured = new Set<number>();

    for (const item of items) {
      // 書き込み間隔（429 予防）。先頭アイテムも前ステップ末尾からの
      // 間隔を保証できないため先に待つ。
      await sleep(WRITE_INTERVAL_MS);
      if (!ensured.has(item.annictWorkId)) {
        const row = await ensureAnnictWork(worksRepo, token, item.annictWorkId);
        if (row) await worksRepo.upsertAnnictWork(row);
        ensured.add(item.annictWorkId);
      }
      const result = await this.writeOne(token, item.episodeNodeId);
      await repo.setItemStatus(
        item.id,
        result.status,
        result.status === "failed" ? result.error : undefined,
      );
      if (result.status === "done" && result.record) {
        await recordsRepo.insertRecord({
          annictWorkId: item.annictWorkId,
          annictEpisodeId: item.annictEpisodeId,
          episodeNodeId: item.episodeNodeId,
          annictRecordId: result.record.annictRecordId,
          recordNodeId: result.record.recordNodeId,
          source: "animeishi",
          recordedAt: new Date(result.record.createdAt),
        });
      }
      await repo.updateJobProgress(jobId, {
        done: result.status === "done" ? 1 : 0,
        failed: result.status === "failed" ? 1 : 0,
        skipped: result.status === "skipped" ? 1 : 0,
      });
    }
    return items.length;
  }

  /**
   * 1 話の createRecord。429 は待って 1 回だけ再試行し、それでも駄目なら
   * その話を failed にしてジョブ自体は進める（1 件の失敗で数千件を
   * 止めない）。
   */
  private async writeOne(
    token: string,
    episodeNodeId: string,
  ): Promise<
    | {
        status: "done";
        record: {
          annictRecordId: number;
          recordNodeId: string;
          createdAt: string;
        };
      }
    | { status: "skipped" }
    | { status: "failed"; error: string }
  > {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const record = await createAnnictRecord(token, episodeNodeId);
        return { status: "done", record };
      } catch (err) {
        if (
          err instanceof AnnictApiError &&
          err.status === 429 &&
          attempt === 0
        ) {
          await sleep(RATE_LIMIT_WAIT_MS);
          continue;
        }
        if (isRetriable(err) && attempt === 0) {
          await sleep(TRANSIENT_RETRY_WAIT_MS);
          continue;
        }
        return { status: "failed", error: errorMessage(err) };
      }
    }
    return { status: "failed", error: "unreachable" };
  }
}
