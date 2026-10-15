import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useAuth } from "@clerk/clerk-expo";
import {
  normalizeAnnictFunnelSurface,
  type AnnictFunnelSurface,
} from "@animeishi/observability";
import {
  buildAuthorizeUrl,
  encodeWebOAuthState,
  parseAuthCallback,
} from "./oauth";
import { ANNICT_CONNECTION_QUERY_KEY } from "./connectionKey";
import { trackAnnictFunnel } from "./funnel";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";
import type {
  AnnictConnectOptions,
  AnnictConnectResult,
  UseAnnictConnect,
} from "./useAnnictConnect";

// Annict OAuth クライアント ID（EXPO_PUBLIC_ なので Web バンドルに埋め込まれてよい）。
// connect 実行時に評価する（テストで env を差し替えやすく、実挙動にも影響しない）。
function getAnnictClientId(): string {
  return process.env.EXPO_PUBLIC_ANNICT_CLIENT_ID ?? "";
}

// state を照合するため、リダイレクト前に sessionStorage に退避しておくキー。
// app/annict.tsx が戻り URL の state と突き合わせる。sessionStorage はタブを閉じると
// 消えるため、CSRF 用の一時値の置き場として妥当。
export const ANNICT_STATE_STORAGE_KEY = "annict_oauth_state";

// ファネル計測用に「どの誘導から連携を始めたか」を退避するキー。
// Web は authorize へのページ遷移で connect() を抜けるため、コールバック側
// （exchangeAnnictWebCallback）が surface を引き継げるよう sessionStorage に置く。
export const ANNICT_FUNNEL_SURFACE_STORAGE_KEY = "annict_funnel_surface";

/**
 * Web の Annict OAuth コールバック着地 URL（例: https://host/annict）。
 *
 * Annict 側に登録できる redirect_uri は固定値のみ。PR プレビュー等の動的な
 * オリジンは登録できないため、EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI に正規の
 * 登録済み URL を設定してそこへ寄せ、戻り先オリジンは state に埋め込んで
 * 正規側から中継する（app/annict.web.tsx 参照）。未設定なら現在のオリジン
 * （ローカル開発や、オリジン自身が登録済みの本番）をそのまま使う。
 */
export function getWebRedirectUri(): string {
  const configured = process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI?.trim();
  if (configured) return configured;
  return `${window.location.origin}/annict`;
}

/**
 * Web の OAuth コールバック処理（純粋ロジック）。app/annict.tsx から呼ぶ。
 *
 * 退避しておいた state を sessionStorage から取り出して照合し、code を
 * exchange(mode:web) に渡す。トークンはサーバー(D1)に保存され、戻り値では
 * 成否のみを返す。UI（表示・遷移）は呼び出し側が担う。
 *
 * @param callbackUrl 戻ってきた URL（window.location.href）。
 * @param getClerkToken Clerk JWT を取得する関数。
 */
export async function exchangeAnnictWebCallback(
  callbackUrl: string,
  getClerkToken: () => Promise<string | null>,
  meta?: { userId?: string | null },
): Promise<AnnictConnectResult> {
  // 退避した state を取り出して照合する（CSRF 対策）。取り出したら消費する。
  // ファネル計測用に退避した surface も同じタイミングで読み取り・消費する。
  let expectedState: string | null = null;
  let surface: AnnictFunnelSurface | undefined;
  try {
    expectedState = window.sessionStorage.getItem(ANNICT_STATE_STORAGE_KEY);
    window.sessionStorage.removeItem(ANNICT_STATE_STORAGE_KEY);
    surface = normalizeAnnictFunnelSurface(
      window.sessionStorage.getItem(ANNICT_FUNNEL_SURFACE_STORAGE_KEY),
    );
    window.sessionStorage.removeItem(ANNICT_FUNNEL_SURFACE_STORAGE_KEY);
  } catch {
    expectedState = null;
  }

  // Web はここ（コールバック着地後）で初めて OAuth の結果が確定するため、
  // 結果ごとに oauth_result を送信する（issue #64）。
  // authorize 先で中断して戻ってこなかった場合はイベント自体が発生せず、
  // 「cta_tap があり oauth_result が無い」差分が Web の離脱として読める。
  const finish = (result: AnnictConnectResult): AnnictConnectResult => {
    trackAnnictFunnel({
      step: "oauth_result",
      surface,
      userId: meta?.userId,
      result: result.status,
      reason: result.status === "error" ? result.reason : undefined,
    });
    return result;
  };

  if (!expectedState) {
    return finish({ status: "error", reason: "state_mismatch" });
  }

  const parsed = parseAuthCallback(callbackUrl, expectedState);
  if (!parsed.ok) {
    return finish({ status: "error", reason: parsed.error });
  }

  const clerkToken = await getClerkToken();
  if (!clerkToken) {
    return finish({ status: "error", reason: "unauthorized" });
  }

  try {
    const res = await apiClient.me.annict.exchange.$post(
      {
        json: {
          code: parsed.code,
          redirectUri: getWebRedirectUri(),
          mode: "web",
        },
      },
      { headers: { Authorization: `Bearer ${clerkToken}` } },
    );
    if (!res.ok) {
      return finish({ status: "error", reason: "exchange_failed" });
    }
    return finish({ status: "success" });
  } catch {
    return finish({ status: "error", reason: "unexpected" });
  }
}

/**
 * Web 版 Annict OAuth 連携フロー。
 *
 * ネイティブと違い WebBrowser（openAuthSessionAsync）は使わない。Web では
 * authorize へ同一タブで遷移し、Annict 承認後に `/annict` へ戻る。戻りの
 * code/state は app/annict.tsx が処理して exchange(mode:web) を叩く。
 * トークンはサーバー(D1)に暗号化保存され、クライアントは保持しない。
 */
export function useAnnictConnect(): UseAnnictConnect {
  const queryClient = useQueryClient();
  const { getToken, userId } = useAuth();
  // Web の connect はページ遷移で完了するため、ボタン連打防止に軽い state を持つ。
  const [isConnecting, setIsConnecting] = useState(false);
  // isConnecting(state) は非同期更新のため、反映前の連打で state（CSRF 値）が
  // 上書きされうる。ref で同期的に再入をブロックする。
  const inFlightRef = useRef(false);

  const connect = useCallback(
    async (options?: AnnictConnectOptions): Promise<AnnictConnectResult> => {
      // Web は authorize 遷移までが connect() の責務で、OAuth の結果は
      // exchangeAnnictWebCallback が送る。ここでは遷移前に確定する失敗だけ
      // oauth_result を送信する（issue #64）。
      const fail = (reason: string): AnnictConnectResult => {
        trackAnnictFunnel({
          step: "oauth_result",
          surface: options?.surface,
          userId,
          result: "error",
          reason,
        });
        return { status: "error", reason };
      };

      const clientId = getAnnictClientId();
      if (!clientId) {
        return fail("not_configured");
      }
      // 進行中なら二重起動させない（遷移成功時のみ ref を立てたまま抜ける）。
      // 再入は OAuth の結果ではないため oauth_result は送らない。
      if (inFlightRef.current) {
        return { status: "cancelled" };
      }
      inFlightRef.current = true;

      setIsConnecting(true);
      // 遷移が起きたら isConnecting は復元しない（ページが離れるため）。
      let didNavigate = false;
      try {
        const redirectUri = getWebRedirectUri();
        // crypto.randomUUID は Web で標準的に使える。CSRF 用の乱数に加えて
        // 戻り先オリジンを state に埋め込み、正規オリジン着弾時の中継に使う。
        const state = encodeWebOAuthState(
          window.location.origin,
          crypto.randomUUID(),
        );
        try {
          window.sessionStorage.setItem(ANNICT_STATE_STORAGE_KEY, state);
          if (options?.surface) {
            window.sessionStorage.setItem(
              ANNICT_FUNNEL_SURFACE_STORAGE_KEY,
              options.surface,
            );
          }
        } catch {
          // sessionStorage 無効化（プライベートブラウズ等）では state 照合ができない
          // ため連携は失敗させる。finally で isConnecting/ref を復元する。
          return fail("storage_unavailable");
        }

        const authorizeUrl = buildAuthorizeUrl({
          clientId,
          redirectUri,
          state,
        });

        // authorize へ遷移する。以降の処理は /annict（app/annict.tsx）に引き継がれ、
        // この関数の Promise は遷移により事実上完了しない。呼び出し側は success を
        // 待たず、遷移が起きたこと自体を成功とみなす。
        window.location.href = authorizeUrl;
        didNavigate = true;
        return { status: "success" };
      } catch {
        return fail("unexpected");
      } finally {
        // 遷移しなかった（＝失敗）ときだけロック/ローディングを解除する。
        if (!didNavigate) {
          inFlightRef.current = false;
          setIsConnecting(false);
        }
      }
    },
    [userId],
  );

  const disconnect = useCallback(async () => {
    // Web はサーバー(D1)にトークンを持つため、サーバーの disconnect を叩いて削除する。
    try {
      const clerkToken = await getToken();
      if (clerkToken) {
        await apiClient.me.annict.disconnect.$post(undefined, {
          headers: { Authorization: `Bearer ${clerkToken}` },
        });
      }
    } finally {
      // 視聴履歴キャッシュを破棄し、連携状態を再取得させる。
      queryClient.removeQueries({ queryKey: WATCH_HISTORY_QUERY_KEY });
      await queryClient.invalidateQueries({
        queryKey: ANNICT_CONNECTION_QUERY_KEY,
      });
    }
  }, [getToken, queryClient]);

  return { connect, disconnect, isConnecting };
}
