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
// - Annict への fetch と D1 への問い合わせの両方にインスタンスごとの予算を
//   持つ（issue #695・#701）。Workers のサブリクエスト上限は Workflow
//   インスタンス単位で数えられる（ステップごと・1 回の実行ごとではない。
//   step.sleep でハイバネートしてもリセットされない）ため、自前の予算を
//   使い切る前に新しいインスタンスへ引き継ぐことでしか上限を回避できない。
//   D1・KV 等の Cloudflare 内部サービス向けの呼び出しは外部 fetch とは
//   別枠の上限（Free プランで 1,000）で数えられる。予算切れ・実上限到達で
//   中断した話は failed にせず pending のまま残し、引き継ぎ先が書き込む。
// - 予算を見て引き継ぐのはユニット（1 作品の対応付け・1 話の書き込み）の
//   境界だけで、ユニットの途中では中断しない。話一覧のページング途中で
//   止めると引き継ぎ先が同じ作品を最初から取り直し、小さい予算では同じ
//   位置で繰り返し枯渇して永久に進まない。各インスタンスが最低 1 ユニット
//   完結してから引き継ぐことで必ず進捗する。引き継ぎ回数自体にも上限を
//   設け、異常に収束しない場合はジョブを failed に倒す。
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
import { countingD1Database, createSubrequestBudget } from "./subrequestBudget";

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
  // 1 インスタンスが使う D1 問い合わせ数の予算（同上）。
  DANIME_D1_SUBREQUEST_BUDGET?: string;
  // インスタンス引き継ぎ回数の上限（テストで小さくして収束しない
  // 場合の failed 化を検証する）。
  DANIME_MAX_HANDOFFS?: string;
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
  /**
   * このインスタンスまでに積み上がった引き継ぎ回数。
   * 初回インスタンスは未設定（0 扱い）。異常に収束しないジョブが
   * インスタンスを無限に作り続けないための上限判定に使う。
   */
  handoffCount?: number;
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
// https://developers.cloudflare.com/workers/platform/limits/#subrequests
// 上限に達すると以降の fetch は全て例外（"Too many subrequests."）になる
// ため、Sentry 送信・障害通知等の余裕分を残して手前で次インスタンスへ
// 引き継ぐ。
const SUBREQUEST_BUDGET_DEFAULT = 40;
// 1 インスタンスが使う D1 問い合わせ数の自前予算（issue #701）。
// Cloudflare 内部サービス向けの上限はインスタンスあたり 1,000（Free）だが、
// 対応付けは作品あたり数クエリを要するため上限ぎりぎりだと引き継ぎの
// 記録自体が失敗し得る。実上限の半分程度で引き継いで余裕を残す。
const D1_SUBREQUEST_BUDGET_DEFAULT = 500;
// インスタンス引き継ぎ回数の上限。1 ユニット（1 作品の対応付け・
// 1 話の書き込み）ごとに必ず進む設計のため、通常は必要な分だけ
// 素直に引き継ぐ。書き込みフェーズは fetch 予算（インスタンスあたり
// ~40 回）が律速なので、数千話規模のジョブでは百数十回の引き継ぎが
// 必要になり得る（429 リトライ込みでさらに増える）。これだけの引き継ぎ
// でも終わらないのはユニット自体が完結しない異常系（実上限を超える
// 巨大ユニット等）なので failed に倒して無限にインスタンスを作らせない。
const HANDOFF_LIMIT_DEFAULT = 500;
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

// Workers のサブリクエスト上限（"Too many subrequests."）に達して
// 呼び出しが例外になったか。annictFetch が生の例外を detail に包んで
// status 0 にするため、中身のメッセージを見て判別する（issue #695）。
// D1 等の Cloudflare 内部サービス向けの上限超過は生のエラーのまま
// 届くため（issue #701）、AnnictApiError 以外もメッセージで判別する。
// status 0 の一時障害と同じ顔をしているが、リトライも failed 確定も
// できない（このインスタンスではもう発行できない）ため特別扱いする。
function isSubrequestLimitError(err: unknown): boolean {
  if (err instanceof AnnictApiError) {
    if (err.status !== 0) return false;
    const detail = err.detail;
    const message = detail instanceof Error ? detail.message : String(detail);
    return /too many subrequests/i.test(message);
  }
  return /too many subrequests/i.test(errorMessage(err));
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
    const handoffs = event.payload.handoffCount ?? 0;
    // D1 への問い合わせもインスタンス単位でサブリクエスト上限に数えられる
    // （内部サービス向けは外部 fetch とは別枠。issue #701）。
    // Annict fetch と同じく、使い切る前に新インスタンスへ引き継ぐ。
    // 問い合わせ自体は拒否しない: 引き継ぎ・失敗記録などの D1 操作は
    // 予算切れ後も必要なため、予算はユニット境界の引き継ぎ判断にだけ使う。
    const d1Budget = createSubrequestBudget(this.d1SubrequestBudget());
    const db = createDb(
      countingD1Database(this.env.DB, () => {
        d1Budget.tryConsume();
      }),
    );
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
    // fetch 自体は拒否しない: ユニット（1 作品の対応付け・1 話の
    // 書き込み）の途中で拒否すると、引き継ぎ先が同じユニットを
    // 最初からやり直して小さい予算では永久に進まなくなる。
    // 引き継ぎ判断はユニットの境界でだけ fetchBudget.remaining を
    // 見て行い、各インスタンスが最低 1 ユニットは完結させる。
    // （インスタンスがハイバネートから再開した場合 run() は最初から
    // 再実行され予算も満タンに戻るが、その場合でも実上限に当たれば
    // "Too many subrequests." を検知して引き継ぐ安全網がある）
    const fetchBudget = createSubrequestBudget(this.subrequestBudget());
    const countedFetch: typeof fetch = (input, init) => {
      fetchBudget.tryConsume();
      return fetch(input, init).catch((err: unknown) => {
        // 実上限到達は AnnictApiError(status 0) に包まれる前に枯渇系の
        // 型に変換する。status 0 のままだと withAnnictRetry が一時障害
        // として無駄にリトライする（同じインスタンスでは以降の fetch
        // も必ず失敗するため回復しない）。
        if (err instanceof Error && /too many subrequests/i.test(err.message)) {
          throw new AnnictBudgetExhaustedError();
        }
        throw err;
      });
    };
    const outOfBudget = () =>
      fetchBudget.remaining <= 0 || d1Budget.remaining <= 0;
    // このインスタンスで完結したユニット数。最初のユニットは予算を
    // 見ずに必ず処理する（0 のまま引き継ぐと進捗なしで無限ループ）。
    let unitsDone = 0;
    // matching 中に実上限系のエラーで run() 全体が落ちたとき、
    // 後続インスタンスの再開位置。ユニット境界の引き継ぎ（resumeIndex）
    // とは別に、catch での安全網用に処理中のバッチ位置を記録する。
    let matchIndex: number | null = null;

    try {
      const job = await doStep("load-job", null, async () => {
        // 進捗参照・新規作成時の調停が「いま動いているインスタンス」を
        // 追えるよう、自分のインスタンス ID を記録する（issue #701）。
        // 引き継ぎ先は初回インスタンス（job.id）とは別の ID で起動する。
        await repo.setJobInstanceId(jobId, event.instanceId, event.instanceId);
        return repo.getJob(jobId);
      });
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
          // 実上限系のエラーで run() が落ちた場合の安全網用に、
          // 処理中のバッチ位置を記録しておく（catch でここから引き継ぐ）。
          matchIndex = i;
          // まだ 1 作品も終えていないなら予算を見ずに進める（進捗 0 の
          // 引き継ぎを繰り返さない）。
          if (unitsDone > 0 && outOfBudget()) {
            resumeIndex = i;
            break;
          }
          const batchRefs = refs.slice(i, i + EPISODES_BATCH_WORKS);
          const fetched = await doStep(
            `annict-episodes-${i}`,
            { retries: { limit: 2, delay: "10 seconds" } },
            () => this.fetchBatchEpisodes(db, userId, batchRefs, countedFetch),
          );
          // 実上限到達ならこのバッチは未処理のまま。バッチ先頭から引き継ぐ。
          if (fetched.budgetExhausted) {
            resumeIndex = i;
            break;
          }
          const episodesByWork = new Map(fetched.entries);
          let j = 0;
          let matchBudgetHit = false;
          for (; j < batchRefs.length && !overBudget(); j++) {
            // 1 作品の対応付け（個別ページングを含む）は中断しない。
            // 予算の確認は作品の境界だけで行う。
            if (unitsDone > 0 && outOfBudget()) break;
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
                  countedFetch,
                ),
            );
            // この作品は未処理（アイテム未登録）。その位置から引き継ぐ。
            if (matched.budgetExhausted) {
              matchBudgetHit = true;
              break;
            }
            unitsDone += 1;
          }
          i += j;
          if (matchBudgetHit || j < batchRefs.length || overBudget()) {
            resumeIndex = i;
            break;
          }
        }
        if (resumeIndex !== null) {
          await doStep("handoff", null, () =>
            this.createContinuation(repo, jobId, userId, {
              fromInstanceId: event.instanceId,
              resumeWorkIndex: resumeIndex,
              handoffs,
            }),
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
        // writing 以降の再開位置は job.status と pending アイテムから
        // 判断されるため、matching の再開位置はもう要らない。
        matchIndex = null;
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
          () =>
            this.writeChunk(
              db,
              repo,
              jobId,
              userId,
              countedFetch,
              outOfBudget,
              unitsDone,
            ),
        );
        unitsDone += written.processed;
        // サブリクエスト予算を使い切った。残りの pending は新しい
        // インスタンス（予算が満タンの実行単位）に引き継ぐ。
        if (written.budgetExhausted) {
          await doStep("handoff", null, () =>
            this.createContinuation(repo, jobId, userId, {
              fromInstanceId: event.instanceId,
              handoffs,
            }),
          );
          return;
        }
        if (written.processed === 0) break;
      }
      if (overBudget()) {
        await doStep("handoff", null, () =>
          this.createContinuation(repo, jobId, userId, {
            fromInstanceId: event.instanceId,
            handoffs,
          }),
        );
        return;
      }
      await doStep("finish", null, () => repo.setJobStatus(jobId, "completed"));
    } catch (err) {
      // 安全網（issue #701）: 予算チェックをすり抜けて D1・fetch の実上限に
      // 達した場合も、残りの処理は後続インスタンスに引き継ぐ。
      // failed に倒すと pending が残って取り込みが止まるため。
      // 引き継ぎ自体が失敗する場合（上限到達で create も失敗する等）は
      // 従来どおり failed に記録する。
      if (isSubrequestCapError(err)) {
        try {
          await this.createContinuation(repo, jobId, userId, {
            fromInstanceId: event.instanceId,
            handoffs,
            ...(matchIndex == null ? {} : { resumeWorkIndex: matchIndex }),
          });
          return;
        } catch {
          // 引き継ぎ失敗はそのまま下の failed 記録へ進む。
        }
      }
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

  /**
   * 残りを処理する後続インスタンスを起動する。
   * 引き継ぎ回数をパラメータで引き回し、上限を超えたら
   * NonRetryableError でジョブを failed に倒す。ユニット単位で
   * 必ず進む設計のためここに来るのは異常系だが、異常時に
   * インスタンスを無限に作り続けないための上限。
   */
  private async createContinuation(
    repo: ReturnType<typeof episodeImportJobRepository>,
    jobId: string,
    userId: string,
    opts: {
      fromInstanceId: string;
      resumeWorkIndex?: number;
      handoffs: number;
    },
  ): Promise<void> {
    const binding = this.env.DANIME_EPISODE_IMPORT;
    if (!binding) {
      throw new NonRetryableError(
        "DANIME_EPISODE_IMPORT binding is required for continuation",
      );
    }
    const limit = this.handoffLimit();
    if (opts.handoffs >= limit) {
      throw new NonRetryableError(
        `episode import job exceeded the workflow handoff limit (${limit})`,
      );
    }
    // インスタンス ID は引き継ぎ回数から決定的に決める（呼び出し元の
    // ID は使い回せない）。自動採番だとステップのリトライで同一ジョブの
    // インスタンスが複数立ち上がり得るが、固定 ID なら 2 回目の create が
    // 失敗するだけで重複起動しない。
    const nextId = `${jobId}-h${opts.handoffs + 1}`;
    // 進捗参照・新規作成時の調停が追うべきインスタンスを先に記録する
    // （issue #701）。記録した ID のインスタンスが存在しない間は
    // 起動中として扱われるため、create との前後関係で取りこぼさない。
    // 記録は「いまの記録値がこの引き継ぎ元の ID」のときだけ行う。
    // このステップがリトライで再実行され、その間に引き継ぎ先がさらに
    // 先へ進んでいた場合に記録を巻き戻さないため（Devin Review #702）。
    await repo.setJobInstanceId(jobId, nextId, opts.fromInstanceId);
    try {
      await binding.create({
        id: nextId,
        params: {
          jobId,
          userId,
          handoffCount: opts.handoffs + 1,
          ...(opts.resumeWorkIndex === undefined
            ? {}
            : { resumeWorkIndex: opts.resumeWorkIndex }),
        },
      });
    } catch (err) {
      // create 成功後にステップが落ちてリトライされた場合、2 回目の
      // create は ID 重複で失敗する。インスタンスが存在していれば
      // 引き継ぎ自体は済んでいるため成功扱いにする。
      const exists = await binding.get(nextId).then(
        () => true,
        () => false,
      );
      if (!exists) throw err;
    }
  }

  private stepBudget(): number {
    const raw = this.env.DANIME_WORKFLOW_STEP_BUDGET;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 1 ? v : STEP_BUDGET_DEFAULT;
  }

  private handoffLimit(): number {
    const raw = this.env.DANIME_MAX_HANDOFFS;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 1 ? v : HANDOFF_LIMIT_DEFAULT;
  }

  private subrequestBudget(): number {
    const raw = this.env.DANIME_SUBREQUEST_BUDGET;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 1 ? v : SUBREQUEST_BUDGET_DEFAULT;
  }

  private d1SubrequestBudget(): number {
    const raw = this.env.DANIME_D1_SUBREQUEST_BUDGET;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 1 ? v : D1_SUBREQUEST_BUDGET_DEFAULT;
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
   * 実上限到達（"Too many subrequests."）は budgetExhausted で返し、
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
    try {
      // トークン解決の D1 読み出しも実上限に当たり得るため、fetch と
      // 同じく枯渇扱いにして引き継ぎ対象にする（issue #701）。
      const token = await this.resolveToken(db, userId);
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
   * 個別ページングは自前予算では中断しない（中断すると引き継ぎ先が
   * 同じ作品を最初から取り直して進まない）。実上限到達だけ
   * アイテム未登録のまま budgetExhausted で返し、呼び出し側が
   * その作品から引き継ぐ。
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
    try {
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
        annictEps =
          (await fetchAnnictWorkEpisodes(
            token,
            work.annictWorkId,
            fetchImpl,
          )) ?? [];
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
    } catch (err) {
      // D1 の実上限到達（"Too many subrequests."）も枯渇扱いにして
      // この作品から引き継ぐ（issue #701）。アイテムは db.batch で
      // まとめて挿入するため、ここに来た時点では未登録のまま残る。
      if (isSubrequestCapError(err)) {
        return { unmatched: 0, budgetExhausted: true };
      }
      throw err;
    }
  }

  /**
   * 書き込み 1 チャンク: pending を WRITE_CHUNK 件だけ取り、約 1 秒間隔で
   * createRecord。processed は確定できた件数（0 で終了判定に使う）。
   * サブリクエスト予算は「1 話ぶん（記録再確認〜createRecord）」を中断
   * しない単位の境界でだけ見る（priorUnits + processed が 1 以上になって
   * から残りを確認する）。途中で拒否すると引き継ぎ先が同じ話をやり直して
   * 進まなくなるため、各インスタンスで最低 1 話は必ず処理する。
   * 実上限到達・境界での予算切れは budgetExhausted で返し、途中の話は
   * failed にせず pending のまま残す（issue #695）。
   */
  private async writeChunk(
    db: DrizzleDb,
    repo: ReturnType<typeof episodeImportJobRepository>,
    jobId: string,
    userId: string,
    fetchImpl: typeof fetch,
    outOfBudget: () => boolean,
    priorUnits: number,
  ): Promise<{ processed: number; budgetExhausted: boolean }> {
    let processed = 0;
    try {
      // pending 一覧・トークン解決の D1 読み出しも実上限に当たり得る
      // （issue #701）。catch で枯渇扱いにするため try の内側に置く。
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

      for (const item of items) {
        // 話の境界でだけ予算を見る。1 話ぶん（再確認〜createRecord）の
        // 途中では中断しないので、小さい予算でも最低 1 話は進む。
        if (priorUnits + processed > 0 && outOfBudget()) {
          return { processed, budgetExhausted: true };
        }
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
