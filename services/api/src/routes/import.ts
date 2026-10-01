import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthVariables } from "@/middleware/auth";
import { danimeMatchRequestSchema } from "@/schema/validators";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// routes/watch-history.ts のコメント参照）。
import { requireAnnictToken } from "@/lib/annict/middleware";
import { searchAnnictWorksByTitles } from "@/lib/annict/client";
import { withAnnictRetry } from "@/lib/annict/retry";
import { matchDanimeWorks } from "@animeishi/danime-core";

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
      const { results, stats } = await matchDanimeWorks(
        (titles) =>
          withAnnictRetry(
            () => searchAnnictWorksByTitles(c.var.annictToken, titles, fetch),
            { onRetry: () => retries++ },
          ),
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
