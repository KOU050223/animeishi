import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { annictExchangeSchema } from "@/schema/validators";
// NOTE: モバイル(apps/mobile)も同名の `@/lib/annict` を持つため、`@/` エイリアスだと
// モバイルの tsconfig 経由で型チェックされる際にモバイル側へ誤解決される。
// API 専用の実装を確実に指すよう相対パスで import する。
import {
  AnnictApiError,
  exchangeAnnictCode,
  fetchAnnictTokenInfo,
  ANNICT_TOKEN_HEADER,
} from "../lib/annict";

// Annict OAuth 連携用バインディング。
// ANNICT_CLIENT_ID は公開可（vars）、ANNICT_CLIENT_SECRET は Workers Secret。
type AnnictBindings = AuthEnv["Bindings"] & {
  ANNICT_CLIENT_ID: string;
  ANNICT_CLIENT_SECRET: string;
};

function getBindings(c: Context): AnnictBindings {
  return c.env as AnnictBindings;
}

const annict = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // 認可コードをアクセストークンに交換する。
  // モバイルが deep link で受領した code をここに渡し、client_secret 付きで
  // Annict と交換する。トークンはサーバーに保存せずモバイルへ返すだけ。
  .post("/exchange", zValidator("json", annictExchangeSchema), async (c) => {
    const { code, redirectUri } = c.req.valid("json");
    const { ANNICT_CLIENT_ID, ANNICT_CLIENT_SECRET } = getBindings(c);

    if (!ANNICT_CLIENT_ID || !ANNICT_CLIENT_SECRET) {
      return c.json({ error: "Annict 連携が構成されていません" }, 500);
    }

    try {
      const token = await exchangeAnnictCode({
        code,
        redirectUri,
        clientId: ANNICT_CLIENT_ID,
        clientSecret: ANNICT_CLIENT_SECRET,
      });

      // トークンの所有者 ID を取得して返す（モバイルが表示等に使える）。
      const info = await fetchAnnictTokenInfo(token.access_token);

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
  // 連携状態を確認する。サーバーはトークンを保存しないため、
  // クライアントが SecureStore のトークンを X-Annict-Token で渡して検証する。
  // ヘッダが無ければ未連携（connected: false）として扱う。
  .get("/", async (c) => {
    const token = c.req.header(ANNICT_TOKEN_HEADER);
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
        // トークンが失効・無効化されている。
        return c.json({ connected: false });
      }
      throw err;
    }
  });

export { annict };
