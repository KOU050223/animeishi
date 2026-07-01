import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { annictExchangeSchema } from "@/schema/validators";
import { createDb } from "@/db/client";
import { authorizedDb } from "@/repository/authorizedDb";
// NOTE: モバイル(apps/mobile)も同名の `@/lib/annict` を持つため、`@/` エイリアスだと
// モバイルの tsconfig 経由で型チェックされる際にモバイル側へ誤解決される。
// API 専用の実装を確実に指すよう相対パスで import する。
import {
  AnnictApiError,
  exchangeAnnictCode,
  fetchAnnictTokenInfo,
  encryptToken,
  decryptToken,
  assertEncryptionKey,
  ANNICT_TOKEN_HEADER,
} from "../lib/annict";

// Annict OAuth 連携用バインディング。
// ANNICT_CLIENT_ID は公開可（vars）、ANNICT_CLIENT_SECRET は Workers Secret。
// ANNICT_ENCRYPTION_KEY は Web 連携でトークンを D1 暗号化保存するための Secret。
type AnnictBindings = AuthEnv["Bindings"] & {
  ANNICT_CLIENT_ID: string;
  ANNICT_CLIENT_SECRET: string;
  ANNICT_ENCRYPTION_KEY?: string;
  DB: D1Database;
};

function getBindings(c: Context): AnnictBindings {
  return c.env as AnnictBindings;
}

const annict = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // 認可コードをアクセストークンに交換する。
  // モバイルが deep link で受領した code をここに渡し、client_secret 付きで
  // Annict と交換する。
  //   - mode:"native"(既定): トークンをボディで返す（クライアントが SecureStore 保持）。
  //   - mode:"web":          トークンを D1 に暗号化保存し、ボディにトークンを含めない。
  .post("/exchange", zValidator("json", annictExchangeSchema), async (c) => {
    const { code, redirectUri, mode } = c.req.valid("json");
    const { ANNICT_CLIENT_ID, ANNICT_CLIENT_SECRET, ANNICT_ENCRYPTION_KEY } =
      getBindings(c);

    if (!ANNICT_CLIENT_ID || !ANNICT_CLIENT_SECRET) {
      return c.json({ error: "Annict 連携が構成されていません" }, 500);
    }
    // Web モードは暗号鍵が必須（無いと平文保存になり設計に反するため 500 で止める）。
    if (mode === "web" && !ANNICT_ENCRYPTION_KEY) {
      return c.json({ error: "Annict 連携が構成されていません" }, 500);
    }

    try {
      const token = await exchangeAnnictCode({
        code,
        redirectUri,
        clientId: ANNICT_CLIENT_ID,
        clientSecret: ANNICT_CLIENT_SECRET,
      });

      // トークンの所有者 ID を取得する（表示・突き合わせ用）。
      const info = await fetchAnnictTokenInfo(token.access_token);

      if (mode === "web") {
        // Web: トークンをクライアントに渡さず D1 に暗号化保存する。
        const encrypted = await encryptToken(
          token.access_token,
          ANNICT_ENCRYPTION_KEY as string,
        );
        const db = createDb(getBindings(c).DB);
        await authorizedDb(db, c.var.clerkUserId).upsertAnnictToken({
          encryptedToken: encrypted,
          annictUserId: info.resource_owner_id,
          scope: token.scope,
        });
        // トークンは返さない。連携済みフラグと所有者 ID のみ返す。
        c.header("Cache-Control", "no-store");
        return c.json({
          connected: true,
          scope: token.scope,
          annictUserId: info.resource_owner_id,
        });
      }

      // native: 生の accessToken を返すため、キャッシュさせない。
      c.header("Cache-Control", "no-store");
      c.header("Pragma", "no-cache");
      return c.json({
        accessToken: token.access_token,
        scope: token.scope,
        annictUserId: info.resource_owner_id,
      });
    } catch (err) {
      if (err instanceof AnnictApiError) {
        // 認可コードが不正・期限切れの場合は 400。それ以外は 502（上流障害）。
        const status = err.status === 401 || err.status === 400 ? 400 : 502;
        return c.json({ error: "Annict 連携に失敗しました" }, status);
      }
      throw err;
    }
  })
  // Web 連携の解除。D1 に保存した暗号化トークンを削除する。
  // ネイティブは SecureStore をクライアント側で消すためこのルートは不要。
  .post("/disconnect", async (c) => {
    const db = createDb(getBindings(c).DB);
    await authorizedDb(db, c.var.clerkUserId).deleteAnnictToken();
    return c.json({ connected: false });
  })
  // 連携状態を確認する。
  //   - X-Annict-Token ヘッダがあればそれで検証（ネイティブ）。
  //   - 無ければ D1 に保存済みの Web 連携トークンを復号して検証する。
  .get("/", async (c) => {
    // 空白だけのヘッダで無駄な upstream 呼び出し（→5xx）を起こさないよう trim する。
    const header = c.req.header(ANNICT_TOKEN_HEADER)?.trim();

    let token = header ?? null;
    // D1 から復号したトークンか（ヘッダ由来なら false）。失効時に D1 行を掃除するため。
    let tokenFromDb = false;
    if (!token) {
      // Web 連携: D1 の暗号化トークンを復号する。
      const { DB, ANNICT_ENCRYPTION_KEY } = getBindings(c);
      if (ANNICT_ENCRYPTION_KEY) {
        const db = createDb(DB);
        const row = await authorizedDb(
          db,
          c.var.clerkUserId,
        ).getAnnictTokenRow();
        if (row) {
          // 鍵形式不正（設定不備）は 500 として表に出す。行の復号失敗のみ未連携扱い。
          await assertEncryptionKey(ANNICT_ENCRYPTION_KEY);
          try {
            token = await decryptToken(
              row.encryptedToken,
              ANNICT_ENCRYPTION_KEY,
            );
            tokenFromDb = true;
          } catch {
            token = null;
          }
        }
      }
    }

    if (!token) {
      return c.json({ connected: false });
    }

    try {
      const info = await fetchAnnictTokenInfo(token);
      return c.json({
        connected: true,
        annictUserId: info.resource_owner_id,
        scope: info.scope,
      });
    } catch (err) {
      if (err instanceof AnnictApiError && err.status === 401) {
        // トークンが失効・無効化されている。D1 由来なら行を掃除して、以降の
        // resolveAnnictToken が同じ失効トークンを返し続けないようにする。
        if (tokenFromDb) {
          await authorizedDb(
            createDb(getBindings(c).DB),
            c.var.clerkUserId,
          ).deleteAnnictToken();
        }
        return c.json({ connected: false });
      }
      throw err;
    }
  });

export { annict };
