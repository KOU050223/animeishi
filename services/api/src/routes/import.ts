import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthVariables } from "@/middleware/auth";
import { danimeMatchRequestSchema } from "@/schema/validators";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// routes/watch-history.ts のコメント参照）。
import { requireAnnictToken } from "@/lib/annict/middleware";
import { annictErrorResponse } from "@/lib/annict/errors";
import { matchDanimeWorks } from "@/lib/danime/match";

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
      const { works } = c.req.valid("json");
      try {
        const results = await matchDanimeWorks(c.var.annictToken, works);
        return c.json({ results }, 200);
      } catch (err) {
        const res = annictErrorResponse(c, err);
        if (res) return res;
        throw err;
      }
    },
  );

export { importRoute };
