import createClient from "openapi-fetch";
import type { paths } from "@animeishi/api-contract";
import { apiUrl } from "@/lib/apiUrl";
import { ApiRequestError, readApiErrorCode } from "@/lib/apiError";
import { clerkSessionToken } from "@/lib/api";
import { buildAnnictAuthHeader } from "@/lib/annict/buildAnnictAuthHeader";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

// X-Annict-Token を付ける操作。openapi.json の security に annictToken を
// 含む操作に加え、schema が bearerAuth のみを宣言していてもサーバーが
// resolveAnnictToken / resolveAnnictWorkCatalog でヘッダを読む操作
// （favorites 登録・おすすめ生成）を現行フックの apiFetch({ annict: true })
// と同じ対象になるよう列挙した。サーバーはヘッダの有無で Annict 解決を
// 分岐するため、対象外のルートに付けると挙動が変わる。API 側で Annict
// 認可を受ける操作が増減したらこの一覧も合わせる。
const ANNICT_OPERATIONS = new Set(
  (
    [
      ["DELETE", "/me/episode-records/{annictEpisodeId}"],
      ["DELETE", "/me/watch-histories/{annictWorkId}"],
      ["GET", "/me/achievements"],
      ["GET", "/me/annict"],
      ["GET", "/me/watch-histories"],
      ["GET", "/me/work-ratings/{annictWorkId}"],
      ["GET", "/works/lookup"],
      ["GET", "/works/search"],
      ["GET", "/works/{annictWorkId}"],
      ["GET", "/works/{annictWorkId}/characters"],
      ["GET", "/works/{annictWorkId}/episodes"],
      ["POST", "/me/analysis/recommendations"],
      ["POST", "/me/favorites/{annictWorkId}"],
      ["POST", "/me/import/danime/match"],
      ["POST", "/me/watch-histories/bulk"],
      ["PUT", "/me/episode-records/{annictEpisodeId}"],
      ["PUT", "/me/watch-histories/{annictWorkId}"],
      ["PUT", "/me/work-ratings/{annictWorkId}"],
    ] satisfies [HttpMethod, keyof paths][]
  ).map(([method, path]) => `${method} ${path}`),
);

/**
 * OpenAPI 仕様（@animeishi/api-contract の schema.d.ts）で型付けした
 * 共通 API クライアント（issue #726）。段階③で hc の apiClient から
 * こちらへ移す。ミドルウェアがやること:
 *
 * - Clerk セッショントークンの Authorization 付与。トークンが取れない
 *   （サインアウト等）ときは付けずに送る。公開ルートがあり、401 に
 *   なった操作は onResponse の ApiRequestError で拾う
 * - ANNICT_OPERATIONS に含まれる操作への X-Annict-Token 付与
 * - !ok を ApiRequestError(status, code) に正規化して投げる
 *   （readApiErrorCode の処理もここに寄せる）
 *
 * 表示文言はクライアントに持たせない。呼び出し側が status / code から
 * i18n の文言を選ぶ（AGENTS.md の「表示文言は呼び出し側が渡す」）。
 */
export const openapiClient = createClient<paths>({ baseUrl: apiUrl });

openapiClient.use({
  async onRequest({ request, schemaPath }) {
    const token = await clerkSessionToken();
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    if (ANNICT_OPERATIONS.has(`${request.method} ${schemaPath}`)) {
      const annictHeader = await buildAnnictAuthHeader();
      for (const [key, value] of Object.entries(annictHeader)) {
        request.headers.set(key, value);
      }
    }
    return request;
  },
  async onResponse({ request, schemaPath, response }) {
    if (!response.ok) {
      throw new ApiRequestError(
        response.status,
        `${request.method} ${schemaPath} failed with status ${response.status}`,
        await readApiErrorCode(response),
      );
    }
    return response;
  },
});
