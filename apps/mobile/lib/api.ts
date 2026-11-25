import { hc } from "hono/client";
import type { Hono } from "hono";
import type { BlankEnv } from "hono/types";
import type { rpcSchema } from "@animeishi/api-contract/rpc";
import { getClerkInstance } from "@clerk/expo";
import i18next from "i18next";
import { apiUrl } from "@/lib/apiUrl";
import {
  ApiRequestError,
  readApiErrorCode,
  readRetryAfterSeconds,
} from "@/lib/apiError";
import { buildAnnictAuthHeader } from "@/lib/annict/buildAnnictAuthHeader";
import type { TranslationKey } from "@/lib/i18n/keys";

type RpcSchema = typeof rpcSchema;
type AppType = Hono<BlankEnv, RpcSchema>;

export const apiClient = hc<AppType>(apiUrl);

export type ApiFetchOptions = {
  /**
   * Annict 認可ヘッダ（X-Annict-Token）を付けるか。
   * 記録系・Annict 参照系のリクエストだけ true にする。既定では付けない
   * （サーバーがヘッダの有無で Annict 解決を分岐するため、不要なリクエストに
   * 付けると挙動が変わる）。
   */
  annict?: boolean;
} & (
  | {
      /**
       * !res.ok のとき ApiRequestError の message に使う文言。
       * i18next 経由で解決されるため、en リソースに無いキーだと ja 文言が出る
       * （型としては TranslationKey を要求するので、新しい文言は en.json に足す）。
       */
      errorMessage: TranslationKey;
      onHttpError?: undefined;
    }
  | {
      errorMessage?: undefined;
      /**
       * 標準の ApiRequestError 化を使わず、呼び出し側が非 2xx 応答から
       * エラーを組み立てる。応答 body の error 文言を優先する等、
       * エラー契約が標準と異なるエンドポイント用。
       */
      onHttpError: (res: Response) => Promise<Error>;
    }
);

/**
 * セッションの Clerk JWT を React の外から取得する。
 * getClerkInstance は native ではシングルトンの Clerk インスタンス、
 * web では window.Clerk を返す（初期化前は undefined になり得る）。
 * publishableKey を渡すのは、ClerkProvider のマウント前に呼ばれた場合でも
 * native でインスタンスを初期化できるようにするため。
 */
export async function clerkSessionToken(): Promise<string | null> {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerk = getClerkInstance(publishableKey ? { publishableKey } : {});
  return (await clerk?.session?.getToken()) ?? null;
}

/**
 * 認証付き API 呼び出し用の共通 fetch（issue #726）。
 * hono client のリクエスト単位オプションに渡す:
 *
 *   const res = await apiClient.me["work-ratings"][":annictWorkId"].$get(
 *     { param: { annictWorkId: "42" } },
 *     { fetch: apiFetch({ annict: true, errorMessage: "評価の取得に失敗しました" }) },
 *   );
 *   return res.json(); // !res.ok は既に ApiRequestError として投げられている
 *
 * やること:
 * - Clerk セッショントークンの Authorization 付与（useAuth の getToken と同じ
 *   セッションを getClerkInstance 経由で参照する）
 * - annict: true のとき X-Annict-Token の付与
 * - !res.ok のとき ApiRequestError(status, i18n 済み errorMessage, code) の送出
 *   （401 も他のステータスと同じく ApiRequestError に正規化する。annict_token_*
 *   系の code は失効検知（isAnnictTokenError）にそのまま伝わる）
 *   errorMessage の代わりに onHttpError を渡すと、この変換を差し替えられる
 *   （応答 body の error 文言を優先する、plain Error を維持する等）
 *
 * トークンが取れない（セッション切れ等）ときは plain の Error を投げる。
 * ApiRequestError にすると observability の 4xx ドロップ対象になり、
 * セッション異常を Sentry で追えなくなるため。
 */
export function apiFetch(options: ApiFetchOptions): typeof fetch {
  const { annict = false } = options;
  return async (input, init) => {
    const token = await clerkSessionToken();
    if (!token)
      throw new Error(i18next.t("認証トークンが取得できませんでした"));
    // hono client は URL 文字列 + init.headers で呼ぶが、Request をそのまま
    // 渡す呼び方でも元のヘッダを保持する（fetch と同じく init.headers が優先）。
    const headers = new Headers(
      init?.headers ??
        (typeof input === "object" && "headers" in input
          ? input.headers
          : undefined),
    );
    headers.set("Authorization", `Bearer ${token}`);
    if (annict) {
      const annictHeader = await buildAnnictAuthHeader();
      for (const [key, value] of Object.entries(annictHeader)) {
        headers.set(key, value);
      }
    }
    const res = await fetch(input, { ...init, headers });
    if (!res.ok) {
      if (options.onHttpError) throw await options.onHttpError(res);
      throw new ApiRequestError(
        res.status,
        i18next.t(options.errorMessage),
        await readApiErrorCode(res),
        readRetryAfterSeconds(res),
      );
    }
    return res;
  };
}
