import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthVariables } from "@/middleware/auth";
import { worksSearchQuerySchema } from "@/schema/validators";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// routes/watch-history.ts のコメント参照）。
import { searchAnnictWorksByTitle } from "@/lib/annict/client";
import { requireAnnictToken } from "@/lib/annict/middleware";
import { annictErrorResponse } from "@/lib/annict/errors";

// 作品検索は Annict searchWorks をプロキシする。Animeishi は作品マスタを持たず、
// 検索のたびに Annict へ問い合わせる（docs/05 PR5）。視聴ステータスは含まない。
const works = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get(
    "/search",
    requireAnnictToken,
    zValidator("query", worksSearchQuerySchema),
    async (c) => {
      const { title, after } = c.req.valid("query");

      try {
        const result = await searchAnnictWorksByTitle(
          c.var.annictToken,
          title,
          after ?? null,
        );
        return c.json(result, 200);
      } catch (err) {
        const res = annictErrorResponse(c, err);
        if (res) return res;
        throw err;
      }
    },
  );

export { works };
