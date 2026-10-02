import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";
import {
  watchHistoryBulkSchema,
  watchHistoryUpsertSchema,
} from "@/schema/validators";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する。
// モバイルの tsconfig は AppType 推論のため API ソースを読み込むが、その paths
// （@/* → apps/mobile/* を優先）が API 側の `@/lib/annict`(index) を
// モバイルの同名ディレクトリへ誤解決してしまう。モバイルに存在しない深いパスを
// 指すことで、この衝突を避けつつ API 単体の解決はそのまま通る。
import {
  AnnictApiError,
  fetchAnnictLibraryEntries,
  fetchAnnictWorkByAnnictId,
  updateAnnictStatus,
} from "@/lib/annict/client";
import { isPersistableState } from "@/lib/annict/statusState";
import { requireAnnictToken } from "@/lib/annict/middleware";
import { withAnnictRetry } from "@/lib/annict/retry";
import { mapWithConcurrency } from "@animeishi/danime-core";
import { captureApiError } from "../observability";
import type { NewAnnictWork, NewWatchHistory } from "@/db/schema";

function getBindings(c: Context): Omit<AuthEnv["Bindings"], "DB"> & {
  DB: D1Database;
} {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & {
    DB: D1Database;
  };
}

// bulk 登録で 1 作品を処理する同時実行数。作品あたり searchWorks +
// updateStatus の往復が直列だと遅いため、Annict レート制限を意識した
// 同時実行数で並列化する（issue #115）。
const BULK_ENTRY_CONCURRENCY = 4;

const watchHistory = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // 本人の視聴履歴は Annict の libraryEntries を正として read-through する。
  // X-Annict-Token が無ければ取得できないため requireAnnictToken を GET だけに掛ける。
  .get("/", requireAnnictToken, async (c) => {
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

    // Annict viewer.libraryEntries を全状態・全ページ取得する。
    // Annict 由来のエラーは app.onError で 401/502 に変換される。
    const entries = await fetchAnnictLibraryEntries(c.var.annictToken);

    // 作品メタ（annict_works キャッシュ）と視聴履歴に整形する。
    // NO_STATE / 未知の state は D1 に保存しないが、作品メタは触れた証跡として残す。
    const now = new Date();
    const works = new Map<number, NewAnnictWork>();
    const historyEntries: Pick<NewWatchHistory, "annictWorkId" | "state">[] =
      [];

    for (const e of entries) {
      works.set(e.annictWorkId, {
        annictWorkId: e.annictWorkId,
        nodeId: e.nodeId,
        malAnimeId: e.malAnimeId,
        title: e.title,
        titleKana: e.titleKana,
        titleEn: e.titleEn,
        seasonName: e.seasonName,
        seasonYear: e.seasonYear,
        imageUrl: e.imageUrl,
        updatedAt: now,
      });
      if (isPersistableState(e.state)) {
        historyEntries.push({ annictWorkId: e.annictWorkId, state: e.state });
      }
    }

    const data = await adb.syncMyLibraryFromAnnict(
      [...works.values()],
      historyEntries,
    );

    // Annict の画像が空 / SNS placeholder / http: に落ちている作品は、
    // upsert 済みの annict_works 行として pending のまま残る。
    // 外部 API での解決は cron が行い、read-through 応答経路から外す
    // （issue #127: Queue 廃止）。既に imageSource が設定済み
    // （'anilist' / 'jikan' / 'none'）の作品はネガキャッシュ扱いで
    // 再問い合わせしない（syncMyLibrary の COALESCE で温存済み）。

    return c.json(data, 200);
  })
  // 視聴ステータス更新は「Annict updateStatus を正」とし、成功後に D1 キャッシュを
  // 追従させる。Annict が正なので、Annict 側更新が失敗したらキャッシュは触らない。
  .put(
    "/:annictWorkId",
    requireAnnictToken,
    zValidator("json", watchHistoryUpsertSchema),
    async (c) => {
      const annictWorkId = Number(c.req.param("annictWorkId"));
      if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
        return c.json({ error: "Invalid annictWorkId" }, 400);
      }

      const data = c.req.valid("json");
      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);
      const token = c.var.annictToken;

      // updateStatus(input.workId) は Annict の Work Node ID を要求する。
      // キャッシュに nodeId があればそれを使い、無ければ searchWorks で解決する
      // （read-through 前にこの作品へ初めて触れたケース）。
      const cached = await adb.getAnnictWorkById(annictWorkId);
      let nodeId = cached?.nodeId ?? null;
      let work = cached;
      // searchWorks で解決した作品メタは、updateAnnictStatus が成功するまで
      // D1 へ書かない（「Annict 更新成功後にのみキャッシュ同期」を守るため、
      // 失敗時に annict_works のメタ/nodeId だけ書き換わるのを防ぐ）。
      let resolvedWork: NewAnnictWork | null = null;

      if (!nodeId) {
        const resolved = await fetchAnnictWorkByAnnictId(token, annictWorkId);
        if (!resolved) {
          return c.json({ error: "Work not found" }, 404);
        }
        nodeId = resolved.nodeId;
        resolvedWork = {
          annictWorkId: resolved.annictWorkId,
          nodeId: resolved.nodeId,
          malAnimeId: resolved.malAnimeId,
          title: resolved.title,
          titleKana: resolved.titleKana,
          titleEn: resolved.titleEn,
          seasonName: resolved.seasonName,
          seasonYear: resolved.seasonYear,
          imageUrl: resolved.imageUrl,
          updatedAt: new Date(),
        };
      }

      await updateAnnictStatus(token, nodeId, data.state);

      // Annict 更新が成功した後にだけ、解決した作品メタをキャッシュへ反映する
      // （watch_history の FK 先 annict_works を満たす）。
      if (resolvedWork) {
        await adb.upsertAnnictWork(resolvedWork);
        work = await adb.getAnnictWorkById(annictWorkId);
      }

      // 作品メタがまだ無い（read-through 前で searchWorks も空振り）ことは上で
      // 404 にしているため、ここでは必ずキャッシュに存在する前提で履歴を upsert する。
      if (!work) {
        return c.json({ error: "Work not found" }, 404);
      }

      const result = await adb.upsertWatchHistory(annictWorkId, {
        state: data.state,
      });

      return c.json(result, 200);
    },
  )
  // dアニメインポート等の一括登録。各作品ごとに PUT と同じ不変条件
  // （Annict updateStatus が正・成功後にのみ D1 を追従）を守りつつ、
  // 1 リクエストで複数作品を同時実行数制限付きで並列処理する。
  // 個別失敗は呼び出し側が再挑戦できるよう per-item で返す。HTTP は成功時
  // 200 のまま（部分成功を捨てないため）で、認証切れ（Annict 401）は以降の
  // 作品を全滅させるだけなので検出した時点で未着手分を打ち切る
  // （処理中の分は実結果を返す）。
  .post(
    "/bulk",
    requireAnnictToken,
    zValidator("json", watchHistoryBulkSchema),
    async (c) => {
      const { entries } = c.req.valid("json");
      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);
      const token = c.var.annictToken;
      const now = new Date();
      const startedAt = Date.now();

      type BulkResult =
        | { annictWorkId: number; ok: true }
        | { annictWorkId: number; ok: false; error: string };

      // 同一作品が異なる状態で並列処理されると Annict への反映順と D1 への
      // 保存順が入れ替わり最終状態が食い違うため、並列化の前に作品ごと
      // 最後の状態だけを残す（逐次実行時代の「後勝ち」と同じ結果になる）。
      const deduped = new Map<number, (typeof entries)[number]>();
      for (const e of entries) deduped.set(e.annictWorkId, e);

      let aborted = false;
      let retries = 0;
      const retried = { onRetry: () => retries++ };

      const workResults = await mapWithConcurrency(
        [...deduped.values()],
        BULK_ENTRY_CONCURRENCY,
        async (entry): Promise<BulkResult> => {
          if (aborted) {
            return {
              annictWorkId: entry.annictWorkId,
              ok: false,
              error: "aborted",
            };
          }

          try {
            // nodeId と作品メタはサーバー側で解決する。キャッシュにあればそれを
            // 使い、無ければ searchWorks で Annict の正データを取る
            // （クライアント提供値を信頼すると共有キャッシュを汚染できるため）。
            let nodeId: string | null = null;
            let resolvedWork: NewAnnictWork | null = null;
            const cached = await adb.getAnnictWorkById(entry.annictWorkId);
            nodeId = cached?.nodeId ?? null;
            if (!nodeId) {
              const resolved = await withAnnictRetry(
                () => fetchAnnictWorkByAnnictId(token, entry.annictWorkId),
                retried,
              );
              if (!resolved) {
                return {
                  annictWorkId: entry.annictWorkId,
                  ok: false,
                  error: "work_not_found",
                };
              }
              nodeId = resolved.nodeId;
              resolvedWork = {
                annictWorkId: resolved.annictWorkId,
                nodeId: resolved.nodeId,
                malAnimeId: resolved.malAnimeId,
                title: resolved.title,
                titleKana: resolved.titleKana,
                titleEn: resolved.titleEn,
                seasonName: resolved.seasonName,
                seasonYear: resolved.seasonYear,
                imageUrl: resolved.imageUrl,
                updatedAt: now,
              };
            }

            // updateStatus は冪等（同じ state の再適用は無害）なので
            // 429 / 一時障害をリトライしてよい。
            await withAnnictRetry(
              () => updateAnnictStatus(token, nodeId, entry.state),
              retried,
            );

            // Annict 更新が成功した後にのみキャッシュを追従させる。
            // キャッシュ済み作品は annict_works 行が既にありメタも Annict 由来で
            // 確定しているため、新規解決時だけ upsert すればよい。
            if (resolvedWork) {
              await adb.upsertAnnictWork(resolvedWork);
            }
            await adb.upsertWatchHistory(entry.annictWorkId, {
              state: entry.state,
            });
            return { annictWorkId: entry.annictWorkId, ok: true };
          } catch (err) {
            if (err instanceof AnnictApiError) {
              // トークン失効は以降の全件が同じく失敗するため未着手分を打ち切る。
              // 上流障害（5xx 等）は該当作品だけ失敗として続行する。
              if (err.status === 401) aborted = true;
              // 部分成功で握りつぶす経路は onError を通らないため、
              // 401 以外の障害はここで明示的に capture する。
              else captureApiError(err, c);
              return {
                annictWorkId: entry.annictWorkId,
                ok: false,
                error:
                  err.status === 401
                    ? "annict_token_invalid"
                    : "annict_upstream",
              };
            }
            // 想定外の失敗（D1 書き込み等）も per-item の失敗として返す。
            // 投げ直すと Promise.all が即 reject して、応答後も他ワーカーの
            // Annict 更新と履歴保存が続き、クライアントの表示と実態が
            // 食い違うため。握りつぶす経路は onError を通らないので
            // Sentry にはここで明示的に送る。
            captureApiError(err, c);
            console.error(
              JSON.stringify({
                level: "error",
                event: "watch_history_bulk_entry",
                annictWorkId: entry.annictWorkId,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
            return {
              annictWorkId: entry.annictWorkId,
              ok: false,
              error: "internal_error",
            };
          }
        },
      );

      // 結果は入力エントリ（重複込み）と件数を揃えて返す。クライアントは
      // 送ったエントリ数と結果数で進捗・残件を計算するため、集約で潰した
      // 重複分は同じ作品の結果をそのまま返す。
      const byWorkId = new Map(workResults.map((r) => [r.annictWorkId, r]));
      const results = entries.map(
        (e) =>
          byWorkId.get(e.annictWorkId) ?? {
            annictWorkId: e.annictWorkId,
            ok: false as const,
            error: "internal_error",
          },
      );

      const elapsedMs = Date.now() - startedAt;
      console.log(
        JSON.stringify({
          level: "info",
          event: "watch_history_bulk",
          entries: entries.length,
          uniqueWorks: deduped.size,
          succeeded: workResults.filter((r) => r.ok).length,
          aborted,
          retries,
          elapsedMs,
        }),
      );
      return c.json({ results, aborted, elapsedMs }, 200);
    },
  )
  .delete("/:annictWorkId", async (c) => {
    const annictWorkId = Number(c.req.param("annictWorkId"));
    if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
      return c.json({ error: "Invalid annictWorkId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    await adb.deleteWatchHistory(annictWorkId);
    return c.json({ success: true }, 200);
  });

export { watchHistory };
