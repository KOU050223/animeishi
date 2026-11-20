// dアニメ話記録ジョブを実行する Cloudflare Workflow（issue #477）。
//
// POST /me/import/danime/episode-jobs がジョブ行＋入力行を D1 に登録して
// 即座に返し、こちらがバックグラウンドで
//   1. 作品ごとに Annict 話一覧を引いて dアニメ話と対応付け（2 方式以上一致のみ確定）
//   2. 確定した話を約 1 秒間隔で createRecord
// を行う。ユーザーは画面を閉じてよい。
//
// 設計上の不変条件:
// - 平文トークンを Workflow の状態に残さない。step.do の戻り値はインスタンス
//   状態として永続化されダッシュボードから見えるため、トークンはステップの
//   戻り値にせず、必要なステップの内側で都度 D1 から復号する。エラー
//   メッセージにも載せない。
// - 各ステップは D1 の状態だけを見て仕事をする（pending アイテム・未処理の
//   作品参照）。途中で落ちても引き継ぎインスタンスが同じ場所から再開でき、
//   書き込み済みの話を再送しない。
// - 1 インスタンスのステップ上限（1,024）に近づいたら新しいインスタンスに
//   引き継ぐ。引き継ぎ先は job.status と resumeWorkIndex から再開位置を
//   判断するため、冪等な再実行（アイテムの重複排除・カウンタの再計算）に
//   なっている。
// - Annict への fetch 回数にもインスタンスごとの予算を持つ（issue #695）。
//   Workers のサブリクエスト上限は Workflow インスタンス単位で数えられる
//   （ステップごと・1 回の実行ごとではない。step.sleep でハイバネートしても
//   リセットされない）ため、自前の予算を使い切る前に新しいインスタンスへ
//   引き継ぐことでしか上限を回避できない。予算切れ・実上限到達で中断した
//   話は failed にせず pending のまま残し、引き継ぎ先が書き込む。
import { WorkflowEntrypoint } from "cloudflare:workers";
import type {
  WorkflowEvent,
  WorkflowStep,
  WorkflowStepConfig,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { createDb } from "@/db/client";
import type { DrizzleDb } from "@/db/client";
import { annictRepository } from "@/features/annict/repository";
import { decryptToken } from "@/lib/annict/crypto";
import {
  AnnictApiError,
  AnnictBudgetExhaustedError,
  createAnnictRecord,
  fetchAnnictWorkEpisodes,
  fetchAnnictWorksEpisodesBatch,
} from "@/lib/annict/client";
import type {
  AnnictWorkEpisode,
  AnnictWorkEpisodesBatch,
} from "@/lib/annict/client";
import { worksRepository } from "@/features/works/repository";
import { episodeRecordsRepository } from "@/features/episode-records/repository";
import { ensureAnnictWork } from "@/features/episode-records";
import {
  matchDanimeWorkEpisodes,
  type DanimeExtractedEpisode,
} from "@animeishi/danime-core";
import { episodeImportJobRepository } from "./repository";
import type { DanimeEpisodeJobWorkRef } from "./repository";
import { createSubrequestBudget } from "./subrequestBudget";

export type DanimeEpisodeImportWorkflowEnv = {
  DB: D1Database;
  ANNICT_ENCRYPTION_KEY?: string;
  // ステップ上限に近づいたとき後続インスタンスを起動するための自分自身への
  // バインディング（wrangler.toml の [[workflows]] で定義）。
  DANIME_EPISODE_IMPORT?: Workflow<DanimeEpisodeImportParams>;
  // 待ち時間の調整。既定はコード内の定数で、テストでは小さい値に変えて
  // 実時間を待たずにジョブを最後まで走らせる（vars に文字列で置く）。
  DANIME_WRITE_INTERVAL_MS?: string;
  DANIME_RATE_LIMIT_WAIT_MS?: string;
  DANIME_TRANSIENT_RETRY_WAIT_MS?: string;
  // テストが少数ステップで引き継ぎを検証できるようにする調整用。
  DANIME_WORKFLOW_STEP_BUDGET?: string;
  // 1 インスタンスが使う Annict fetch 数の予算（テストで小さくして
  // サブリクエスト上限での引き継ぎを検証する）。
  DANIME_SUBREQUEST_BUDGET?: string;
};

// Workflow パラメータには識別子だけを載せる。話一覧（大きい）と
// Annict トークン（平文）は載せない。
export type DanimeEpisodeImportParams = {
  jobId: string;
  userId: string;
  /**
   * 引き継ぎインスタンスが対応付けを再開する作品 index。
   * matching 中にステップ上限へ達したときだけ設定される。
   * writing 以降の引き継ぎでは job.status が "writing" のため
   * 対応付け自体がスキップされる。
   */
  resumeWorkIndex?: number;
};

// Annict 話一覧の一括取得（WORKS_EPISODES_QUERY）は searchWorks first:50
// まで載るため 25 作品を 1 リクエストにまとめる。バッチ結果は後続の
// match-* ステップへクロージャ経由で渡す（ステップ間でやり取りされるのは
// この戻り値だけで、トークンは含まない）。
const EPISODES_BATCH_WORKS = 25;
// 書き込み 1 ステップあたりの話数。1 話の処理が連続するよう小さく刻み、
// ステップ単位で途中経過を永続化する（ステップが死んでも完了分は残る）。
const WRITE_CHUNK = 8;
// 1 インスタンスが使う Annict fetch 数の自前予算（issue #695）。
// Workers Free のサブリクエスト上限は Workflow インスタンスあたり外部
// fetch 50（D1 等の Cloudflare サービス向けは別枠 1,000）。
// https://developers.cloudflare.com/workflows/reference/limits/
// 上限に達すると以降の fetch は全て例外（"Too many subrequests."）になる
// ため、Sentry 送信・障害通知等の余裕分を残して手前で次インスタンスへ
// 引き継ぐ。
const SUBREQUEST_BUDGET_DEFAULT = 40;
// 1 インスタンスのステップ数上限は 1,024（Free プラン）。末尾の
// finalize/begin-writing/finish/handoff と余裕を残して手前で引き継ぐ。
const STEP_BUDGET_DEFAULT = 900;
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

// Workers のサブリクエスト上限（"Too many subrequests."）に達して fetch が
// 例外になったか。annictFetch が生の例外を detail に包んで status 0 にする
// ため、中身のメッセージを見て判別する（issue #695）。
// status 0 の一時障害と同じ顔をしているが、リトライも failed 確定も
// できない（このインスタンスではもう fetch できない）ため特別扱いする。
function isSubrequestLimitError(err: unknown): boolean {
  if (!(err instanceof AnnictApiError) || err.status !== 0) return false;
  const detail = err.detail;
  const message = detail instanceof Error ? detail.message : String(detail);
  return /too many subrequests/i.test(message);
}

// サブリクエスト枯渇系のエラーか（自前の予算切れ or Workers の実上限）。
// これが出た話は failed にせず pending のまま残し、新しいインスタンスへ
// 引き継ぐ対象。
function isSubrequestCapError(err: unknown): boolean {
  return (
    err instanceof AnnictBudgetExhaustedError || isSubrequestLimitError(err)
  );
}

// episodesJson を対応付け入力に戻す。壊れた JSON は「話なし」に潰さず
// ステップを失敗させてリトライに回す（データ不整合を黙認しない）。
function parseJobWorkEpisodes(episodesJson: string): DanimeExtractedEpisode[] {
  const raw = JSON.parse(episodesJson) as unknown;
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
    // このインスタンスで消費したステップ数。上限に近づいたら残りを
    // 後続インスタンスに引き継ぐ（引き継ぎ自体も 1 ステップ消費する）。
    let stepCount = 0;
    const doStep = <T>(
      name: string,
      config: WorkflowStepConfig | null,
      fn: () => Promise<T>,
    ): Promise<T> => {
      stepCount += 1;
      // step.do のコールバックは Serializable<T> を要求する。ここで扱う
      // 値は全てシリアライズ可能なので never に落として渡し、呼び出し側
      // では元の T で受ける。
      const cb = fn as () => Promise<never>;
      return config ? step.do(name, config, cb) : step.do(name, cb);
    };
    const overBudget = () => stepCount >= this.stepBudget();

    // Annict への fetch を数えるインスタンス単位の予算（issue #695）。
    // Workers のサブリクエスト上限はインスタンスで累計されるため、
    // 使い切る前に新インスタンスへ引き継いで上限到達を避ける。
    // （インスタンスがハイバネートから再開した場合 run() は最初から
    // 再実行され予算も満タンに戻るが、その場合でも実上限に当たれば
    // "Too many subrequests." を検知して引き継ぐ安全網がある）
    const fetchBudget = createSubrequestBudget(this.subrequestBudget());
    const budgetedFetch: typeof fetch = (input, init) => {
      if (!fetchBudget.tryConsume()) {
        return Promise.reject(new AnnictBudgetExhaustedError());
      }
      return fetch(input, init);
    };

    try {
      const job = await doStep("load-job", null, () => repo.getJob(jobId));
      if (!job) {
        throw new NonRetryableError(`episode import job was deleted: ${jobId}`);
      }
      // 完了・失敗済みのジョブを再実行しても何もしない（重複起動への保険）。
      if (job.status === "completed" || job.status === "failed") return;

      if (job.status === "matching") {
        const refs = await doStep("load-work-refs", null, () =>
          repo.listJobWorkRefs(jobId),
        );
        // matching 中の引き継ぎで指定された再開位置から進める。
        // resumeWorkIndex より前の作品は前のインスタンスが処理済み。
        let i = event.payload.resumeWorkIndex ?? 0;
        let resumeIndex: number | null = null;
        while (i < refs.length) {
          const batchRefs = refs.slice(i, i + EPISODES_BATCH_WORKS);
          const fetched = await doStep(
            `annict-episodes-${i}`,
            { retries: { limit: 2, delay: "10 seconds" } },
            () => this.fetchBatchEpisodes(db, userId, batchRefs, budgetedFetch),
          );
          // 予算切れならこのバッチは未処理のまま。バッチ先頭から引き継ぐ。
          if (fetched.budgetExhausted) {
            resumeIndex = i;
            break;
          }
          const episodesByWork = new Map(fetched.entries);
          let j = 0;
          let matchBudgetHit = false;
          for (; j < batchRefs.length && !overBudget(); j++) {
            const matched = await doStep(
              `match-${i + j}`,
              { retries: { limit: 2, delay: "10 seconds" } },
              () =>
                this.matchWork(
                  db,
                  repo,
                  jobId,
                  userId,
                  batchRefs[j]!,
                  episodesByWork,
                  budgetedFetch,
                ),
            );
            // この作品は未処理（アイテム未登録）。その位置から引き継ぐ。
            if (matched.budgetExhausted) {
              matchBudgetHit = true;
              break;
            }
          }
          i += j;
          if (matchBudgetHit || j < batchRefs.length || overBudget()) {
            resumeIndex = i;
            break;
          }
        }
        if (resumeIndex !== null) {
          await doStep("handoff", null, () =>
            this.createContinuation(jobId, userId, resumeIndex),
          );
          return;
        }
        // カウンタは派生値の代入で確定する（加算でないため冪等）。
        await doStep("finalize-match", null, () =>
          repo.finalizeJobMatchCounts(jobId),
        );
        await doStep("begin-writing", null, () =>
          repo.setJobStatus(jobId, "writing"),
        );
      }

      // 書き込みフェーズ。pending アイテムを先頭から取って書き込み、
      // 無くなるまで繰り返す。ステップがリトライしても pending だけを
      // 読むので書き込み済みの話を再送しない。
      let batch = 0;
      while (!overBudget()) {
        const written = await doStep(
          `write-${batch++}`,
          {
            retries: { limit: 2, delay: "30 seconds" },
            timeout: "10 minutes",
          },
          () => this.writeChunk(db, repo, jobId, userId, budgetedFetch),
        );
        // サブリクエスト予算を使い切った。残りの pending は新しい
        // インスタンス（予算が満タンの実行単位）に引き継ぐ。
        if (written.budgetExhausted) {
          await doStep("handoff", null, () =>
            this.createContinuation(jobId, userId),
          );
          return;
        }
        if (written.processed === 0) break;
      }
      if (overBudget()) {
        await doStep("handoff", null, () =>
          this.createContinuation(jobId, userId),
        );
        return;
      }
      await doStep("finish", null, () => repo.setJobStatus(jobId, "completed"));
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
   * ジョブ所有ユーザーの D1 保存トークンを復号する。
   * step.do の内側からだけ呼ぶ。復号結果をステップの戻り値にしないのは
   * 戻り値がインスタンス状態として永続化されるため（平文を残さない）。
   */
  private async resolveToken(db: DrizzleDb, userId: string): Promise<string> {
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
  }

  /** ステップ上限に近づいたとき、残りを処理する後続インスタンスを起動する。 */
  private async createContinuation(
    jobId: string,
    userId: string,
    resumeWorkIndex?: number,
  ): Promise<void> {
    const binding = this.env.DANIME_EPISODE_IMPORT;
    if (!binding) {
      throw new NonRetryableError(
        "DANIME_EPISODE_IMPORT binding is required for continuation",
      );
    }
    // インスタンス ID は自動採番（呼び出し元の ID を使い回せない）。
    await binding.create({
      params: {
        jobId,
        userId,
        ...(resumeWorkIndex === undefined ? {} : { resumeWorkIndex }),
      },
    });
  }

  private stepBudget(): number {
    const raw = this.env.DANIME_WORKFLOW_STEP_BUDGET;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 1 ? v : STEP_BUDGET_DEFAULT;
  }

  private subrequestBudget(): number {
    const raw = this.env.DANIME_SUBREQUEST_BUDGET;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 1 ? v : SUBREQUEST_BUDGET_DEFAULT;
  }

  private writeIntervalMs(): number {
    return this.msOverride("DANIME_WRITE_INTERVAL_MS", WRITE_INTERVAL_MS);
  }

  private rateLimitWaitMs(): number {
    return this.msOverride("DANIME_RATE_LIMIT_WAIT_MS", RATE_LIMIT_WAIT_MS);
  }

  private transientRetryWaitMs(): number {
    return this.msOverride(
      "DANIME_TRANSIENT_RETRY_WAIT_MS",
      TRANSIENT_RETRY_WAIT_MS,
    );
  }

  private msOverride(
    name:
      | "DANIME_WRITE_INTERVAL_MS"
      | "DANIME_RATE_LIMIT_WAIT_MS"
      | "DANIME_TRANSIENT_RETRY_WAIT_MS",
    fallback: number,
  ): number {
    const raw = this.env[name];
    if (raw === undefined) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  }

  /**
   * Annict 話一覧の一括取得ステップ。25 作品ぶんを 1 リクエストで取る。
   * 戻り値は Rpc.Serializable にするため [workId, batch] の配列で返し、
   * match-* ステップへはクロージャ経由で Map に戻して渡す。
   * トークンはこのステップ内で復号し、戻り値には含めない。
   * サブリクエスト予算切れ・実上限到達は budgetExhausted で返し、
   * 失敗（リトライ対象）にはしない（呼び出し側が引き継ぎを判断する）。
   */
  private async fetchBatchEpisodes(
    db: DrizzleDb,
    userId: string,
    refs: DanimeEpisodeJobWorkRef[],
    fetchImpl: typeof fetch,
  ): Promise<{
    entries: [number, AnnictWorkEpisodesBatch][];
    budgetExhausted: boolean;
  }> {
    const token = await this.resolveToken(db, userId);
    try {
      const batch = await fetchAnnictWorksEpisodesBatch(
        token,
        refs.map((r) => r.annictWorkId),
        fetchImpl,
      );
      return {
        entries: batch.map((b) => [b.annictWorkId, b]),
        budgetExhausted: false,
      };
    } catch (err) {
      if (isSubrequestCapError(err)) {
        return { entries: [], budgetExhausted: true };
      }
      throw err;
    }
  }

  /**
   * 対応付け 1 ステップ（1 作品）。バッチ取得済みの話一覧を使い、
   * バッチに載らない（話が 50 話超等）作品は個別ページングで補う。
   * 確定分はアイテム表に登録（既登録の Annict 話 ID は除く）。
   * カウンタはここでは触らず finalize-match で一括再計算する
   * （このステップがリトライしても副作用が重ならないように）。
   * サブリクエスト予算切れ・実上限到達はアイテム未登録のまま
   * budgetExhausted で返し、呼び出し側がその作品から引き継ぐ。
   */
  private async matchWork(
    db: DrizzleDb,
    repo: ReturnType<typeof episodeImportJobRepository>,
    jobId: string,
    userId: string,
    ref: DanimeEpisodeJobWorkRef,
    episodesByWork: Map<number, AnnictWorkEpisodesBatch>,
    fetchImpl: typeof fetch,
  ): Promise<{ unmatched: number; budgetExhausted: boolean }> {
    const work = await repo.getJobWork(ref.id);
    if (!work) return { unmatched: 0, budgetExhausted: false };
    const watched = parseJobWorkEpisodes(work.episodesJson).filter(
      (e) => e.watched,
    );
    if (watched.length === 0) {
      return { unmatched: 0, budgetExhausted: false };
    }

    let annictEps: AnnictWorkEpisode[];
    const hit = episodesByWork.get(work.annictWorkId);
    if (hit && !hit.hasMoreEpisodes) {
      annictEps = hit.episodes;
    } else {
      const token = await this.resolveToken(db, userId);
      try {
        annictEps =
          (await fetchAnnictWorkEpisodes(
            token,
            work.annictWorkId,
            fetchImpl,
          )) ?? [];
      } catch (err) {
        if (isSubrequestCapError(err)) {
          return { unmatched: 0, budgetExhausted: true };
        }
        throw err;
      }
    }

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
    // 同一ジョブに既登録の Annict 話は除外する。対応付けステップの
    // リトライやインスタンス引き継ぎ時の範囲重複で同じ話を二度積まない
    // （別の dアニメ作品が同じ Annict 作品・話に確定した場合も重複排除）。
    const existing = await repo.listItemEpisodeIdsIn(
      jobId,
      res.matched.map((m) => m.annictEpisodeId),
    );
    const items = res.matched
      .filter((m) => !existing.has(m.annictEpisodeId))
      .map((m) => {
        // Annict に記録済みの話は書かない（事前突き合わせ）。
        const status: "pending" | "skipped" = tracked.get(m.annictEpisodeId)
          ? "skipped"
          : "pending";
        return {
          jobId,
          annictWorkId: work.annictWorkId,
          annictEpisodeId: m.annictEpisodeId,
          episodeNodeId: m.episodeNodeId,
          status,
        };
      });
    await repo.insertJobItems(items);
    return { unmatched: res.unresolved.length, budgetExhausted: false };
  }

  /**
   * 書き込み 1 チャンク: pending を WRITE_CHUNK 件だけ取り、約 1 秒間隔で
   * createRecord。processed は確定できた件数（0 で終了判定に使う）。
   * サブリクエスト予算切れ・実上限到達は budgetExhausted で返し、
   * 途中の話は failed にせず pending のまま残す（issue #695）。
   * 1 作品あたりの fetch 上限（話一覧ページング + メタ解決 + createRecord）
   * が予算全体を超えることはないので、pending の先頭を残した引き継ぎは
   * 必ず進捗する（無限引き継ぎにならない）。
   */
  private async writeChunk(
    db: DrizzleDb,
    repo: ReturnType<typeof episodeImportJobRepository>,
    jobId: string,
    userId: string,
    fetchImpl: typeof fetch,
  ): Promise<{ processed: number; budgetExhausted: boolean }> {
    const items = await repo.listPendingItems(jobId, WRITE_CHUNK);
    if (items.length === 0) return { processed: 0, budgetExhausted: false };

    const token = await this.resolveToken(db, userId);
    const worksRepo = worksRepository(db);
    const recordsRepo = episodeRecordsRepository(db, userId);
    // episode_records の annict_works FK 用にキャッシュを保証する。
    // 同じ作品が連続するため 1 ステップ内では解決済みを覚えて使い回す。
    const ensured = new Set<number>();
    // createRecord は非冪等なので、書き込み直前に Annict 側の記録状況を
    // 再確認する。対応付け〜書き込みの間に別経路で記録された話や、
    // createRecord 成功後に finishItem 前で落ちて pending が残った話を
    // 二重に書かないため。作品ごとに必要になった時点で 1 回だけ確認する
    // （先に全作品ぶん取ると、チャンク途中で予算切れになったとき無駄な
    // fetch を消費し、引き継ぎ先でも同じ場所で止まり得る）。
    const trackedNow = new Map<number, Set<number>>();

    let processed = 0;
    try {
      for (const item of items) {
        if (!trackedNow.has(item.annictWorkId)) {
          try {
            const eps = await fetchAnnictWorkEpisodes(
              token,
              item.annictWorkId,
              fetchImpl,
            );
            trackedNow.set(
              item.annictWorkId,
              new Set(
                (eps ?? [])
                  .filter((e) => e.viewerDidTrack)
                  .map((e) => e.annictEpisodeId),
              ),
            );
          } catch (err) {
            // 上限系は「状況不明」ではなく引き継ぎ対象なので投げ直す。
            if (isSubrequestCapError(err)) throw err;
            // 状況不明の作品は writeOne の再試行に任せる（再確認は
            // チャンク内で 1 度だけ。空集合を入れて再 fetch を防ぐ）。
            trackedNow.set(item.annictWorkId, new Set());
          }
        }
        if (trackedNow.get(item.annictWorkId)?.has(item.annictEpisodeId)) {
          await repo.finishItem(jobId, item.id, "skipped");
          processed += 1;
          continue;
        }
        // 書き込み間隔（429 予防）。先頭アイテムも前ステップ末尾からの
        // 間隔を保証できないため先に待つ。
        await sleep(this.writeIntervalMs());
        if (!ensured.has(item.annictWorkId)) {
          const row = await ensureAnnictWork(
            worksRepo,
            token,
            item.annictWorkId,
            fetchImpl,
          );
          if (row) await worksRepo.upsertAnnictWork(row);
          ensured.add(item.annictWorkId);
        }
        const result = await this.writeOne(
          token,
          item.episodeNodeId,
          fetchImpl,
        );
        // アイテム確定を記録ログより先にする。逆順だと、ログ挿入後に
        // 落ちた場合アイテムが pending のまま残り、再開時に同じ話へ
        // createRecord を再送してしまう。この順序なら最悪でもログ行が
        // 欠けるだけで、episode_records は Annict との突合で補完される。
        await repo.finishItem(
          jobId,
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
        processed += 1;
      }
      return { processed, budgetExhausted: false };
    } catch (err) {
      // 予算切れ・実上限到達: 確定済みはそのまま残し、中断した話は
      // pending のまま新しいインスタンスに引き継ぐ。
      if (isSubrequestCapError(err)) {
        return { processed, budgetExhausted: true };
      }
      throw err;
    }
  }

  /**
   * 1 話の createRecord。429 は待って 1 回だけ再試行し、それでも駄目なら
   * その話を failed にしてジョブ自体は進める（1 件の失敗で数千件を
   * 止めない）。
   * サブリクエスト枯渇系のエラーだけは failed にせず投げ返す
   * （pending のまま引き継ぎ対象にするため。issue #695）。
   */
  private async writeOne(
    token: string,
    episodeNodeId: string,
    fetchImpl: typeof fetch,
  ): Promise<
    | {
        status: "done";
        record: {
          annictRecordId: number;
          recordNodeId: string;
          createdAt: string;
        };
      }
    | { status: "failed"; error: string }
  > {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const record = await createAnnictRecord(
          token,
          episodeNodeId,
          fetchImpl,
        );
        return { status: "done", record };
      } catch (err) {
        if (isSubrequestCapError(err)) throw err;
        if (
          err instanceof AnnictApiError &&
          err.status === 429 &&
          attempt === 0
        ) {
          await sleep(this.rateLimitWaitMs());
          continue;
        }
        if (isRetriable(err) && attempt === 0) {
          await sleep(this.transientRetryWaitMs());
          continue;
        }
        return { status: "failed", error: errorMessage(err) };
      }
    }
    return { status: "failed", error: "unreachable" };
  }
}
