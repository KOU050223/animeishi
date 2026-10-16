// Annict 連携ファネルの計測（issue #64）。ブラウザバック等で連携を
// やめる層を含め、「誘導の表示 → CTA タップ → OAuth 結果」を Sentry Logs で
// 追えるようにする。
// 送信経路は汎用 UI イベント計測（lib/events.ts、issue #214）に共通化。
// イベント名・属性は既存ダッシュボードとの互換のため変えない
// （platform は呼び出し側で付けるため汎用経路側の自動付与は無効化する）。
// Web は OAuth 画面へその場で遷移するため、遷移前に flushAnnictFunnel で
// 送信済み分をバッファへ乗せてから Sentry.flush() する。
import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useAuth } from "@clerk/clerk-expo";
import {
  ANNICT_FUNNEL_ATTRS,
  ANNICT_FUNNEL_EVENT,
  type AnnictFunnelResult,
  type AnnictFunnelStep,
  type AnnictFunnelSurface,
} from "@animeishi/observability";
import { flushTrackedEvents, trackEvent } from "@/lib/events";

// annict_connect_funnel イベントの属性。汎用経路の userId ハッシュ化を
// そのまま使い、キー名だけ annict.user_key にする。
export type AnnictFunnelInput = {
  step: AnnictFunnelStep;
  /** 誘導を表示した場所。Web の sessionStorage 経由等で不明なら省略する。 */
  surface?: AnnictFunnelSurface;
  /** 生の Clerk userId。送信前にハッシュ化する。未サインインなら省略・null 可。 */
  userId?: string | null;
  /** oauth_result ステップの結果。 */
  result?: AnnictFunnelResult;
  /** result=error のときの理由（exchange_failed 等）。 */
  reason?: string;
};

// UI イベントを送る。計測の失敗・遅延で連携フローを壊さないよう、
// 常に fire-and-forget（内部で非同期にハッシュ化して送信）にする。
export function trackAnnictFunnel(input: AnnictFunnelInput): void {
  const attributes: Record<string, string> = {
    [ANNICT_FUNNEL_ATTRS.step]: input.step,
    // beforeSend（finalizeEvent）はエラーイベントにだけ効くため、
    // ログ側では platform を属性として自分で付ける。
    platform: Platform.OS,
  };
  if (input.surface) {
    attributes[ANNICT_FUNNEL_ATTRS.surface] = input.surface;
  }
  if (input.result) {
    attributes[ANNICT_FUNNEL_ATTRS.result] = input.result;
  }
  if (input.reason) {
    attributes[ANNICT_FUNNEL_ATTRS.reason] = input.reason;
  }
  trackEvent(ANNICT_FUNNEL_EVENT, attributes, {
    // 省略時は「未サインイン」として送る。汎用経路のコンテキスト userId への
    // フォールバックは、既存挙動（input.userId 省略時に user_key を付けない）
    // を変えないよう明示的に null で無効化する。
    userId: input.userId ?? null,
    userKeyAttr: ANNICT_FUNNEL_ATTRS.userKey,
    autoAttributes: false,
  });
}

// 進行中のファネルイベント送信が Sentry のログバッファへ乗るのを待つ。
// Web は OAuth 画面への遷移でバッファごと捨てられるため、遷移前にこれと
// Sentry.flush() を呼んで消失を防ぐ。
export async function flushAnnictFunnel(): Promise<void> {
  await flushTrackedEvents();
}

// 画面側用。surface を固定して step だけ渡せるトラッカーを返す。
// prompt_view は「誘導が表示された」ことが分かる粒度（ソフトゲートの
// マウント、連携カードが未連携表示になった時点など）で呼ぶ。
export function useAnnictFunnel(surface: AnnictFunnelSurface) {
  const { userId } = useAuth();
  // レンダー中に取得した userId をコールバック参照時に読めるよう ref に保持する
  // （getToken() 等で userId が解決する前のレンダーでも最新値を見せるため）。
  // render 中の ref 更新は React の規約違反なため effect で同期する。
  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);
  return useCallback(
    (
      step: AnnictFunnelStep,
      extra?: { result?: AnnictFunnelResult; reason?: string },
    ) => {
      trackAnnictFunnel({
        step,
        surface,
        userId: userIdRef.current ?? undefined,
        result: extra?.result,
        reason: extra?.reason,
      });
    },
    [surface],
  );
}
