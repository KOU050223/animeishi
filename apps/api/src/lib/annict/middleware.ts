import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { createDb } from "@/db/client";
import { annictRepository } from "@/features/annict/repository";
import { decryptToken, assertEncryptionKey } from "./crypto";
import { createAnnictWorkCatalog, type AnnictWorkCatalog } from "./workCatalog";

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
  // 未連携の利用者の作品情報取得に使う運営者の共用トークン（issue #561）。
  // 未設定なら未連携の利用者は従来どおり連携が必要になる。
  ANNICT_SHARED_READ_TOKEN?: string;
};

// 作品情報系ルート向けの Variables。トークン文字列は載せず、作品情報の取得関数
// だけを持つ AnnictWorkCatalog を載せる（workCatalog.ts の冒頭コメント参照）。
export type AnnictWorkCatalogVariables = {
  Variables: {
    clerkUserId: string;
    annictWorkCatalog: AnnictWorkCatalog;
  };
};

function annictTokenRequired(c: Context) {
  return c.json(
    { error: "Annict 連携が必要です", code: "annict_token_required" },
    401,
  );
}

/**
 * X-Annict-Token ヘッダ、または Web 連携で D1 に保存された暗号化トークンを解決する。
 * どちらも無い場合は 401 を返す（Annict 連携が必要な記録系ルート向け）。
 *
 * 注: D1 経由の解決には requireAuth（clerkUserId）が先に走っている必要がある。
 */
export const requireAnnictToken = createMiddleware<AnnictVariables>(
  async (c, next) => {
    const token = await resolveAnnictToken(c);
    if (!token) return annictTokenRequired(c);
    c.set("annictToken", token);
    await next();
  },
);

/**
 * 作品情報だけを返すルート向け。本人のトークンがあればそれを、無ければ共用トークンを
 * 使う AnnictWorkCatalog を c.var.annictWorkCatalog にセットする。どちらも無ければ
 * requireAnnictToken と同じ 401（annict_token_required）を返す。
 */
export const requireAnnictWorkCatalog =
  createMiddleware<AnnictWorkCatalogVariables>(async (c, next) => {
    const catalog = await resolveAnnictWorkCatalog(c);
    if (!catalog) return annictTokenRequired(c);
    c.set("annictWorkCatalog", catalog);
    await next();
  });

/** 共用トークンが設定されていればその値を返す（前後の空白は除く）。 */
export function sharedAnnictReadToken(c: Context): string | null {
  const { ANNICT_SHARED_READ_TOKEN } = c.env as AnnictTokenBindings;
  return ANNICT_SHARED_READ_TOKEN?.trim() || null;
}

/**
 * 作品情報の取得窓口を解決する（本人のトークン → 共用トークンの順）。どちらも
 * 無ければ null。requireAnnictWorkCatalog 以外（例: お気に入り追加時の作品補充）でも使う。
 */
export async function resolveAnnictWorkCatalog(
  c: Context,
): Promise<AnnictWorkCatalog | null> {
  const userToken = await resolveAnnictToken(c);
  if (userToken) return createAnnictWorkCatalog(userToken, "user");
  const sharedToken = sharedAnnictReadToken(c);
  if (sharedToken) return createAnnictWorkCatalog(sharedToken, "shared");
  return null;
}

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
  const row = await annictRepository(db, clerkUserId).getAnnictTokenRow();
  if (!row) return null;

  // 設定不備（鍵の形式不正）と行データの復号失敗を区別する。
  // 鍵自体が不正なら Web 連携済みユーザー全員が未連携に見えてしまい、サーバー不備に
  // 気づけない。鍵は先に検証して不正なら throw（ルート層で 500 として表に出す）。
  await assertEncryptionKey(ANNICT_ENCRYPTION_KEY);

  try {
    return await decryptToken(row.encryptedToken, ANNICT_ENCRYPTION_KEY);
  } catch {
    // 鍵は妥当なのに復号できない = この行だけ壊れている/鍵ローテーション後の旧行。
    // 未連携扱いにして再連携を促す（サーバー全体の不備ではない）。
    return null;
  }
}
