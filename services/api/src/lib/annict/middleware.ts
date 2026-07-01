import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { createDb } from "@/db/client";
import { authorizedDb } from "@/repository/authorizedDb";
import { decryptToken } from "./crypto";

// Annict アクセストークンを解決するミドルウェア。
// c.var.annictToken にトークンをセットする。
//
// 設計（docs/05 + 追補）: トークンの持ち方は 2 系統ある。
//   - ネイティブ: 端末 SecureStore に保存し、リクエストごとに X-Annict-Token ヘッダで運ぶ。
//   - Web:        サーバーが D1 に AES-GCM 暗号化して保存し、clerkUserId で復号して使う。
// 解決順序は「ヘッダ → D1(clerkUserId で復号)」。ヘッダがあればネイティブ扱いで即採用し、
// 無ければ Web 連携済みとみなして D1 から復号する。

export const ANNICT_TOKEN_HEADER = "X-Annict-Token";

// hono/client（RPC）向け: Bindings を含まない Variables 型。
// D1 経由の解決には requireAuth 済みの clerkUserId が要るため、それも前提にする。
export type AnnictVariables = {
  Variables: {
    clerkUserId: string;
    annictToken: string;
  };
};

// D1 復号に必要な Bindings。requireAuth 後段で使う前提。
type AnnictTokenBindings = {
  DB: D1Database;
  ANNICT_ENCRYPTION_KEY?: string;
};

/**
 * X-Annict-Token ヘッダ、または Web 連携で D1 に保存された暗号化トークンを解決する。
 * どちらも無い場合は 401 を返す（Annict 連携が必要な記録系ルート向け）。
 *
 * 注: D1 経由の解決には requireAuth（clerkUserId）が先に走っている必要がある。
 */
export const requireAnnictToken = createMiddleware<AnnictVariables>(
  async (c, next) => {
    const token = await resolveAnnictToken(c);
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

/**
 * Annict トークンを解決する（ヘッダ優先、無ければ D1 から復号）。見つからなければ null。
 * requireAnnictToken 以外（例: GET /me/annict の任意解決）でも使えるよう関数化する。
 */
export async function resolveAnnictToken(c: Context): Promise<string | null> {
  const header = c.req.header(ANNICT_TOKEN_HEADER)?.trim();
  if (header) return header;

  // Web 連携: clerkUserId で D1 の暗号化トークンを引いて復号する。
  const clerkUserId = c.get("clerkUserId") as string | undefined;
  if (!clerkUserId) return null;

  const { DB, ANNICT_ENCRYPTION_KEY } = c.env as AnnictTokenBindings;
  if (!ANNICT_ENCRYPTION_KEY) return null;

  const db = createDb(DB);
  const row = await authorizedDb(db, clerkUserId).getAnnictTokenRow();
  if (!row) return null;

  try {
    return await decryptToken(row.encryptedToken, ANNICT_ENCRYPTION_KEY);
  } catch {
    // 鍵ローテーション等で復号できない場合は未連携扱い（再連携を促す）。
    return null;
  }
}
