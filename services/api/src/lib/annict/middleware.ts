import { createMiddleware } from "hono/factory";

// X-Annict-Token ヘッダで運ばれてくる Annict アクセストークンを読み取り、
// c.var.annictToken にセットするミドルウェア。
//
// 設計（docs/05）: サーバーは Annict トークンを保存しない。記録/更新リクエストの
// たびにモバイルの SecureStore から X-Annict-Token ヘッダで送られてくる。
// 「Annict へ書く」と「D1 キャッシュへ書く」を 1 リクエストで完結させるため、
// トークンはこのヘッダ経由で個々のルートに渡す。

export const ANNICT_TOKEN_HEADER = "X-Annict-Token";

// hono/client（RPC）向け: Bindings を含まない Variables 型。
export type AnnictVariables = {
  Variables: {
    annictToken: string;
  };
};

/**
 * X-Annict-Token を必須とするミドルウェア。
 * ヘッダが無い場合は 401 を返す（Annict 連携が必要な記録系ルート向け）。
 */
export const requireAnnictToken = createMiddleware<AnnictVariables>(
  async (c, next) => {
    const token = c.req.header(ANNICT_TOKEN_HEADER);
    if (!token) {
      return c.json(
        { error: "Annict 連携が必要です", code: "annict_token_required" },
        401,
      );
    }
    c.set("annictToken", token);
    await next();
  },
);
