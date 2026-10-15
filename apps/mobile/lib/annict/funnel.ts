// Annict 連携ファネルの計測送信（issue #64）。
// 「連携誘導の表示 → CTA タップ → OAuth 完了」のコンバージョンと
// 離脱ポイントを Sentry Logs へ送る。Logs は Issue を作らないため
// エラーアラートのノイズにならず、属性で絞って集計できる。
// 設計は docs/08_observability-design.md のファネル節を参照。
import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import { useAuth } from "@clerk/clerk-expo";
import * as Crypto from "expo-crypto";
import * as Sentry from "@sentry/react-native";
import {
  ANNICT_FUNNEL_ATTRS,
  ANNICT_FUNNEL_EVENT,
  type AnnictFunnelResult,
  type AnnictFunnelStep,
  type AnnictFunnelSurface,
} from "@animeishi/observability";

export type AnnictFunnelInput = {
  step: AnnictFunnelStep;
  /** 誘導を表示した場所。Web の sessionStorage 経由等で不明なら省略する。 */
  surface?: AnnictFunnelSurface;
  /** 生の Clerk userId。送信前にハッシュ化する。未サインインなら省略可。 */
  userId?: string | null;
  /** oauth_result ステップの結果。 */
  result?: AnnictFunnelResult;
  /** result=error のときの理由（exchange_failed 等）。 */
  reason?: string;
};

// ファネル計測イベントを送る。計測の失敗・遅延で本体処理を
// 壊さないよう、常に fire-and-forget（内部で非同期にハッシュ化して送信）にする。
export function trackAnnictFunnel(input: AnnictFunnelInput): void {
  void send(input);
}

async function send(input: AnnictFunnelInput): Promise<void> {
  try {
    const userKey = input.userId
      ? await annictFunnelUserKey(input.userId)
      : undefined;
    const attributes: Record<string, string> = {
      [ANNICT_FUNNEL_ATTRS.step]: input.step,
      // beforeSend（finalizeEvent）はエラーイベントにだけ効くため、
      // ログ側では platform を属性として自分で付ける。
      platform: Platform.OS,
    };
    if (input.surface) attributes[ANNICT_FUNNEL_ATTRS.surface] = input.surface;
    if (input.result) attributes[ANNICT_FUNNEL_ATTRS.result] = input.result;
    if (input.reason) attributes[ANNICT_FUNNEL_ATTRS.reason] = input.reason;
    if (userKey) attributes[ANNICT_FUNNEL_ATTRS.userKey] = userKey;
    Sentry.logger.info(ANNICT_FUNNEL_EVENT, attributes);
  } catch {
    // 計測送信の失敗は握りつぶす（連携フロー自体に影響させない）。
  }
}

// Clerk userId の生値を送らず、ソルト付き SHA-256 の先頭だけを擬似キーにする。
// 個人の特定は避けつつ、同一ユーザーのファネル通過率は追える粒度に留める。
const USER_KEY_SALT = "animeishi-annict-funnel-v1:";
const USER_KEY_LENGTH = 16;

// 同一ユーザーのイベントごとに digest を取り直さないよう結果をキャッシュする。
const userKeyCache = new Map<string, Promise<string | undefined>>();

function annictFunnelUserKey(userId: string): Promise<string | undefined> {
  const cached = userKeyCache.get(userId);
  if (cached) return cached;
  // Promise 境界の内側で呼ぶことで、ネイティブモジュール不在（テスト環境等）の
  // 同期例外も「キー無しで送る」にフォールバックし、イベント自体は落とさない。
  const promise = Promise.resolve()
    .then(() =>
      Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        USER_KEY_SALT + userId,
      ),
    )
    .then((digest) => digest.slice(0, USER_KEY_LENGTH))
    .catch(() => undefined);
  userKeyCache.set(userId, promise);
  return promise;
}

// surface を束縛した送信関数を返す。Clerk の userId はセッション復元途中だと
// 一時的に null になるため、呼び出し時点の最新値を ref 経由で読む
// （mount 直後の prompt_view で userId が未解決でも欠落したまま送る）。
export function useAnnictFunnel(surface: AnnictFunnelSurface) {
  const { userId } = useAuth();
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  return useCallback(
    (
      step: AnnictFunnelStep,
      extra?: Pick<AnnictFunnelInput, "result" | "reason">,
    ) => {
      trackAnnictFunnel({
        step,
        surface,
        userId: userIdRef.current,
        ...extra,
      });
    },
    [surface],
  );
}
