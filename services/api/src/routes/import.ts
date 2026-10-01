import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthVariables } from "@/middleware/auth";
import { danimeMatchRequestSchema } from "@/schema/validators";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// routes/watch-history.ts のコメント参照）。
import { requireAnnictToken } from "@/lib/annict/middleware";
import { searchAnnictWorksByTitles } from "@/lib/annict/client";
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
      const results = await matchDanimeWorks(
        // Annict へのアクセスは AnnictSearcher として注入する
        // （core は通信を持たない）。
        (titles) => searchAnnictWorksByTitles(c.var.annictToken, titles, fetch),
        works,
        registeredWorkIds,
      );
      return c.json({ results }, 200);
    },
  );

export { importRoute };
