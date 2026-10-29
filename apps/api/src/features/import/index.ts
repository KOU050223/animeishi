import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthVariables } from "@/middleware/auth";
import { danimeMatchRequestSchema } from "./schema";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// features/watch-history/index.ts のコメント参照）。
import { requireAnnictToken } from "@/lib/annict/middleware";
import {
  AnnictApiError,
  isAnnictGraphQLError,
  searchAnnictWorksByTitles,
} from "@/lib/annict/client";
import { withAnnictRetry } from "@/lib/annict/retry";
import { matchDanimeWorks } from "@animeishi/danime-core";
import type { AnnictSearcher } from "@animeishi/danime-core";

// dアニメストア インポート用ルート。
// 抽出はクライアント側（ネイティブ WebView 注入 / Web ブックマークレット）が担い、
// ここでは抽出結果の作品タイトル群を Annict 作品へ照合する。
// 登録（updateStatus + D1 追従）は既存の watch-history ルートが担う。
const importRoute = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // マッチングは Annict searchWorks を叩くため Annict トークン必須。
  .post(
    "/danime/match",
    requireAnnictToken,
    zValidator("json", danimeMatchRequestSchema),
    async (c) => {
      const { works, registeredWorkIds } = c.req.valid("json");
      // Annict へのアクセスは AnnictSearcher として注入する
      // （core は通信を持たない）。並列化した検索で 429 / 一時障害に
      // 当たる可能性が上がるためリトライを噛ませ、回数を stats に載せる。
      let retries = 0;
      const searcher: AnnictSearcher = async (titles, context) => {
        const retriesBefore = retries;
        try {
          return await withAnnictRetry(
            () => searchAnnictWorksByTitles(c.var.annictToken, titles, fetch),
            { onRetry: () => retries++ },
          );
        } catch (err) {
          // 入力由来の GraphQL エラーは、その検索語だけを諦めて次へ進める:
          // - 第 2 パスは 1 検索語ずつ投げるため、第 1 パスで弾かれたタイトルの
          //   バリアント由来のエラーが残り得る。
          // - 第 1 パスも 10 件単位の分割で端数が 1 件になるチャンクがあり、
          //   複数作品の取り込みではその 1 件だけを未マッチにする。
          // 作品 1 件だけの取り込みや、複数検索語の検索が全滅した場合は
          // 上流障害として握らずに投げる（上流障害を「未マッチ」に見せない）。
          if (
            isAnnictGraphQLError(err) &&
            (context?.phase === "secondPass" ||
              (titles.length === 1 && works.length > 1))
          ) {
            console.warn(
              JSON.stringify({
                level: "warn",
                event: "danime_title_search_failed",
                phase: context?.phase ?? "unknown",
                titleCount: titles.length,
                titleSample: titles
                  .slice(0, 3)
                  .map((t) => (t.length > 80 ? `${t.slice(0, 80)}…` : t)),
                annictStatus: err.status,
                error: err.message,
              }),
            );
            return [];
          }
          // 502（annict_upstream）に化ける前に原因を追える構造化ログを残す
          // （issue #219: 失敗時にログが無く本番の原因を特定できなかった）。
          // タイトルは切り分け用に先頭数件だけ。トークン・ユーザー情報は含めない。
          console.error(
            JSON.stringify({
              level: "error",
              event: "danime_match_failed",
              phase: context?.phase ?? "unknown",
              titleCount: titles.length,
              titleSample: titles
                .slice(0, 3)
                .map((t) => (t.length > 80 ? `${t.slice(0, 80)}…` : t)),
              retries: retries - retriesBefore,
              annictStatus: err instanceof AnnictApiError ? err.status : null,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
          throw err;
        }
      };
      const { results, stats } = await matchDanimeWorks(
        searcher,
        works,
        registeredWorkIds,
      );
      const statsWithRetries = { ...stats, retries };
      // 検索回数・リトライ・経過時間を構造化ログに残す
      // （並列化の効果を本番でも定量評価するため）。
      console.log(
        JSON.stringify({
          level: "info",
          event: "danime_match",
          inputWorks: works.length,
          ...statsWithRetries,
        }),
      );
      return c.json({ results, stats: statsWithRetries }, 200);
    },
  );

export { importRoute };
