import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { episodeRecordsRepository } from "./repository";
import type { AnnictRecordLogEntry } from "./repository";
import { worksRepository } from "../works/repository";
import { createDb } from "@/db/client";
import { annictEpisodeIdParamSchema } from "./schema";
import { annictWorkIdParamSchema } from "../works/schema";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// features/watch-history/index.ts のコメント参照）。
import {
  AnnictApiError,
  createAnnictRecord,
  deleteAnnictRecord,
  fetchAnnictEpisodeByAnnictId,
  fetchAnnictViewerRecords,
  fetchAnnictWorkByAnnictId,
  fetchAnnictWorkEpisodes,
} from "@/lib/annict/client";
import { annictRepository } from "../annict/repository";
import { requireAnnictToken } from "@/lib/annict/middleware";
import { withAnnictRetry } from "@/lib/annict/retry";
import type { NewAnnictWork } from "@/db/schema";

function getBindings(c: Context): Omit<AuthEnv["Bindings"], "DB"> & {
  DB: D1Database;
} {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & {
    DB: D1Database;
  };
}

// episode_records は annict_works への FK を持つ。記録の前に作品メタが
// キャッシュされていることを保証し、無ければ Annict から引いて upsert する
// （searchWorks は read-only なので先に解決し、Annict への書き込み成功後に
// キャッシュする watch-history と同じ不変条件を守る）。
async function ensureAnnictWork(
  worksRepo: ReturnType<typeof worksRepository>,
  token: string,
  annictWorkId: number,
): Promise<NewAnnictWork | null> {
  const cached = await worksRepo.getAnnictWorkById(annictWorkId);
  if (cached) return null;
  const resolved = await fetchAnnictWorkByAnnictId(token, annictWorkId);
  if (!resolved) return null;
  return {
    annictWorkId: resolved.annictWorkId,
    nodeId: resolved.nodeId,
    malAnimeId: resolved.malAnimeId,
    title: resolved.title,
    titleKana: resolved.titleKana,
    titleEn: resolved.titleEn,
    seasonName: resolved.seasonName,
    seasonYear: resolved.seasonYear,
    imageUrl: resolved.imageUrl,
    watchersCount: resolved.watchersCount ?? null,
    updatedAt: new Date(),
  };
}

// Annict が「既に存在しない record」への deleteRecord に返すエラーか。
// RecordNotFound 系は GraphQL errors（HTTP 200 + errors 配列）として返る
// ため、AnnictApiError のメッセージを見て判定する。判定できない失敗は
// 「残っているかもしれない」側に倒して呼び出し側で失敗にする。
function isAnnictRecordNotFoundError(err: unknown): boolean {
  return (
    err instanceof AnnictApiError &&
    /couldn't find|not found/i.test(err.message)
  );
}

// 話の記録（PUT: 記録 / DELETE: チェック解除）と話数一覧（GET）を束ねる
// feature。記録の正は Annict の record で、D1 の episode_records は
// 「記録した」イベントのログとして成功した操作だけに追従する（issue #439）。
// PUT/DELETE は「記録した/消した」のイベント書き込みなので失敗時に
// D1 だけ進めない。GET の D1 同期（既存 Annict 記録の取り込み）は
// best-effort で、失敗しても話数一覧自体は返す（次回取得で収束する）。
const episodeRecords = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .put(
    "/:annictEpisodeId",
    requireAnnictToken,
    zValidator("param", annictEpisodeIdParamSchema),
    async (c) => {
      const { annictEpisodeId } = c.req.valid("param");
      const token = c.var.annictToken;
      const db = createDb(getBindings(c).DB);
      const repo = episodeRecordsRepository(db, c.var.clerkUserId);
      const worksRepo = worksRepository(db);

      // Episode の Node ID・所属作品・本人の記録状況を解決する。
      const episode = await fetchAnnictEpisodeByAnnictId(
        token,
        annictEpisodeId,
      );
      if (!episode) return c.json({ error: "Episode not found" }, 404);

      // チェック UI の二重 submit や「次の話」ボタンの連打で同じ話に
      // 複数 record を作らないよう、記録済みなら no-op にする。
      // （Annict は同じ話への再記録を許すが、チェック一覧のモデルでは
      // 記録済み = true であり、再記録操作はこの経路からは行わない）
      if (!episode.viewerDidTrack) {
        // FK 制約のため、記録を入れる前に作品行の所在を確定させる
        // （キャッシュ upsert は createRecord 成功後）。
        const pendingWork = await ensureAnnictWork(
          worksRepo,
          token,
          episode.annictWorkId,
        );

        // createRecord は新規 record を作る書き込みで冪等ではないため、
        // 429/5xx の自動リトライは二重記録になり得る。ここではリトライせず、
        // 失敗時はクライアントに再試行を委ねる。
        const record = await createAnnictRecord(token, episode.nodeId);

        if (pendingWork) await worksRepo.upsertAnnictWork(pendingWork);
        await repo.insertRecord({
          annictWorkId: episode.annictWorkId,
          annictEpisodeId,
          episodeNodeId: episode.nodeId,
          annictRecordId: record.annictRecordId,
          recordNodeId: record.recordNodeId,
          source: "animeishi",
          recordedAt: new Date(record.createdAt),
        });
        return c.json(
          {
            recorded: true,
            annictRecordId: record.annictRecordId,
            recordedAt: new Date(record.createdAt),
          },
          200,
        );
      }

      return c.json(
        { recorded: false, annictRecordId: null, recordedAt: null },
        200,
      );
    },
  )
  .delete(
    "/:annictEpisodeId",
    requireAnnictToken,
    zValidator("param", annictEpisodeIdParamSchema),
    async (c) => {
      const { annictEpisodeId } = c.req.valid("param");
      const token = c.var.annictToken;
      const db = createDb(getBindings(c).DB);
      const repo = episodeRecordsRepository(db, c.var.clerkUserId);

      const episode = await fetchAnnictEpisodeByAnnictId(
        token,
        annictEpisodeId,
      );
      if (!episode) return c.json({ error: "Episode not found" }, 404);

      // 消す record の Node ID を viewer.records から解決する。
      // 対象話の記録を辿り切れない部分取得では「見つからなかった分」が
      // Annict に残り、D1 だけ消すと再取得でチェックが復活するずれが起きる。
      // 消せた分だけ成功扱いにせず、この場合は失敗にしてクライアントに
      // 再試行を委ねる。
      let recordNodeIds: string[];
      if (episode.viewerRecordsCount > 0) {
        const { records, complete } = await fetchAnnictViewerRecords(token, {
          filter: (r) => r.annictEpisodeId === annictEpisodeId,
          expectedCount: episode.viewerRecordsCount,
        });
        if (!complete) {
          return c.json(
            { error: "Annict の記録一覧を取得しきれませんでした" },
            502,
          );
        }
        // 辿り切れた viewer.records が削除対象の正。D1 にだけ残る
        // Node ID は Annict 側で既に削除済みなので、再削除を要求しない。
        recordNodeIds = records.map((r) => r.recordNodeId);
      } else {
        // viewerRecordsCount=0 = Annict にこの話の記録は無い。D1 の
        // Node ID は既に削除済みのものなので削除を要求せずログだけ消す。
        recordNodeIds = [];
      }

      // 同一話に複数 record がある（再視聴）場合は全件消して
      // 「未視聴」状態に戻す。deleteRecord は 1 record ずつのみ。
      for (const recordNodeId of recordNodeIds) {
        try {
          await withAnnictRetry(() => deleteAnnictRecord(token, recordNodeId));
        } catch (err) {
          // 取得と削除の間に Annict 側で消えた record への deleteRecord は
          // 「既に無い」= 目的達成済みなのでスキップし、残りの削除を続ける。
          if (isAnnictRecordNotFoundError(err)) continue;
          throw err;
        }
      }

      // Annict 側の削除が成功した後にだけ D1 ログを消す
      // （先に消すと次回の同期で「Annict に残る記録」が復活してしまう）。
      await repo.deleteByEpisode(annictEpisodeId);
      return c.json({ success: true }, 200);
    },
  );

// 作品詳細シートの話数チェック一覧が使う話数マスタ + 記録状況。
// 話のマスタは Annict episodes が正。viewer.records を読み、D1 の
// episode_records ログと合わせる（issue #439 の「Annict 側の既存の記録も
// 読み込んで D1 のログと合わせる」）。返すのは Annict の viewerDidTrack を
// 見たチェック状態と、D1 に取り込んだ記録日時（lastRecordedAt）。
const workEpisodes = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get(
    "/:annictWorkId/episodes",
    requireAnnictToken,
    zValidator("param", annictWorkIdParamSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const token = c.var.annictToken;
      const db = createDb(getBindings(c).DB);
      const repo = episodeRecordsRepository(db, c.var.clerkUserId);
      const worksRepo = worksRepository(db);

      const episodes = await fetchAnnictWorkEpisodes(token, annictWorkId);
      if (!episodes) return c.json({ error: "Work not found" }, 404);

      // Annict 側の既存記録を D1 ログに同期する。対象はこの作品の record のみ。
      // viewer.records は CREATED_AT 降順なので、期待件数（作品の全話の
      // viewerRecordsCount 合計）が集まったら打ち切れる。
      const expectedCount = episodes.reduce(
        (sum, e) => sum + e.viewerRecordsCount,
        0,
      );
      // Annict 側の記録数が 0 でも、D1 にこの作品のログが残っていれば
      // 「全件削除済み」を反映するため同期が要る（reconcile は viewer.records
      // を対象分まで辿り切れた complete=true のときだけ削除反映される）。
      const hasSyncedRows = (await repo.listByWork(annictWorkId)).some(
        (r) => r.annictRecordId != null,
      );
      if (expectedCount > 0 || hasSyncedRows) {
        try {
          const { records, complete, viewerAnnictId } =
            await fetchAnnictViewerRecords(token, {
              filter: (r) => r.annictWorkId === annictWorkId,
              expectedCount,
            });

          // Web 連携ユーザーは annict_tokens に連携時の Annict アカウント
          // ID を持つ。トークンの viewer が連携アカウントと食い違うなら、
          // 別アカウントの記録を本人のログに混ぜる（reconcile で元のログを
          // 消す）ため同期しない。ネイティブのヘッダトークンは結び付けを
          // 持たず判定できないので、その場合はそのまま同期する。
          const boundAnnictUserId = (
            await annictRepository(db, c.var.clerkUserId).getAnnictTokenRow()
          )?.annictUserId;
          const accountMismatch =
            boundAnnictUserId != null &&
            viewerAnnictId != null &&
            boundAnnictUserId !== viewerAnnictId;

          if (accountMismatch) {
            console.error(
              JSON.stringify({
                level: "warn",
                event: "episode_records_sync_skipped_account_mismatch",
                annictWorkId,
                boundAnnictUserId,
                viewerAnnictId,
              }),
            );
          } else {
            // episode_records は annict_works への FK を持つ。未キャッシュの
            // 作品はメタを upsert してから同期しないと insert が落ちる
            // （PUT と同じ不変条件）。
            const pendingWork = await ensureAnnictWork(
              worksRepo,
              token,
              annictWorkId,
            );
            if (pendingWork) await worksRepo.upsertAnnictWork(pendingWork);
            await repo.syncAnnictRecords(
              annictWorkId,
              records.map((r): AnnictRecordLogEntry => ({
                annictRecordId: r.annictRecordId,
                recordNodeId: r.recordNodeId,
                annictEpisodeId: r.annictEpisodeId,
                recordedAt: new Date(r.createdAt),
              })),
              new Map(episodes.map((e) => [e.annictEpisodeId, e.nodeId])),
              // complete（対象分を辿り切れた）ときだけ削除反映を行う。
              // 部分取得だと「取れなかった分」を削除と誤判定するため。
              complete,
            );
          }
        } catch (err) {
          // 記録ログの同期は best-effort。話数一覧（viewerDidTrack）自体は
          // 正しいので応答は返し、同期は次回の取得で収束する。
          console.error(
            JSON.stringify({
              level: "warn",
              event: "episode_records_sync_failed",
              annictWorkId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }

      // 同期後の D1 ログから、話ごとの最終記録日時を応答に載せる。
      const d1Rows = await repo.listByWork(annictWorkId);
      const lastRecordedByEpisode = new Map<number, Date>();
      for (const row of d1Rows) {
        const prev = lastRecordedByEpisode.get(row.annictEpisodeId);
        if (!prev || row.recordedAt > prev) {
          lastRecordedByEpisode.set(row.annictEpisodeId, row.recordedAt);
        }
      }

      return c.json(
        {
          episodes: episodes.map((e) => ({
            annictEpisodeId: e.annictEpisodeId,
            number: e.number,
            numberText: e.numberText,
            sortNumber: e.sortNumber,
            title: e.title,
            watched: e.viewerDidTrack,
            recordsCount: e.viewerRecordsCount,
            lastRecordedAt:
              lastRecordedByEpisode.get(e.annictEpisodeId) ?? null,
          })),
        },
        200,
      );
    },
  );

export { episodeRecords, workEpisodes };
