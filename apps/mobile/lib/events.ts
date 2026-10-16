// 汎用 UI イベント計測（issue #214）。主要ボタンの押下を Sentry Logs へ送る。
// #64 の Annict ファネル計測（lib/annict/funnel.ts）の送信経路を汎用化した
// もので、PII 非送信・userId のハッシュ化・fire-and-forget・送信失敗で
// UI を止めない性質は共通。annict_connect_funnel もこの経路で送る
// （イベント名・属性は既存ダッシュボード互換のため変えない）。
// イベント名・属性キーの一覧は @animeishi/observability、設計は
// docs/08_observability-design.md の「UI イベント計測」節を参照。
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import {
  ANNICT_FUNNEL_EVENT,
  EventRateLimiter,
  TRACK_EVENT_ATTRS,
  type TrackedEventName,
} from "@animeishi/observability";

// trackEvent で送れるイベント名。汎用 UI イベントに加えて、既存の
// annict_connect_funnel も同じ経路で送るため含める。
type TrackableEventName = TrackedEventName | typeof ANNICT_FUNNEL_EVENT;

export type TrackEventOptions = {
  /**
   * 生の Clerk userId。送信前にハッシュ化する。
   * 省略（undefined）すると同期済みコンテキストの userId を使う。
   * 「未サインインとして送る」場合は明示的に null を渡す
   * （annict ファネルのように呼び出し側が userId を持つ経路向け）。
   */
  userId?: string | null;
  /** ハッシュ済み userId を書き込む属性キー（既定 user_key）。 */
  userKeyAttr?: string;
  /**
   * 自動属性（event.name / platform / app_version / screen）を付けるか
   * （既定 true）。annict_connect_funnel は既存の属性セットを変えないため
   * false で呼び、platform は呼び出し側が付ける。
   */
  autoAttributes?: boolean;
  /**
   * レート制限のキー（既定はイベント名）。annict_connect_funnel のように
   * 同一イベント名で段階（step）を分ける計測では、先行ステップの連打が
   * 後続ステップの送信枠を食い潰さないようステップ別キーを渡す。
   */
  rateLimitKey?: string;
  /**
   * screen 属性を同期済みコンテキストより優先する値。
   * 画面遷移直後のイベントは親レイアウトの同期 effect より先に
   * 発火しうるため、発火側が所属画面を明示する用途で使う。
   */
  screen?: string;
};

// 進行中の送信を追跡する（Web のページ遷移前に flushTrackedEvents で
// バッファへ乗るのを待つため）。send は例外を握りつぶすので Promise は
// 常に成功で解決する。
const pendingSends = new Set<Promise<void>>();

// 計測イベントが無料枠を食い潰さないよう同一イベント名あたりの送信回数を
// 制限する（issue #214。既定値は EVENT_RATE_LIMIT）。
const rateLimiter = new EventRateLimiter();

// 計測コンテキスト。現在の画面パスとサインイン中の userId を
// useEventTrackingContext（app/_layout.tsx）が同期する。
// ミューテーションコールバック等のコンポーネント外からも使えるよう
// モジュール状態に持つ。
const eventContext = {
  userId: undefined as string | null | undefined,
  screen: undefined as string | undefined,
};

// 計測コンテキストの同期。useEventTrackingContext（ルートレイアウトで
// 1 度だけ呼ばれる）からのみ呼ぶ。指定したキーだけ更新する。
export function setEventContext(partial: {
  userId?: string | null;
  screen?: string;
}): void {
  if ("userId" in partial) {
    eventContext.userId = partial.userId;
  }
  if ("screen" in partial) {
    eventContext.screen = partial.screen;
  }
}

// UI イベントを送る。計測の失敗・遅延で本体処理を壊さないよう、
// 常に fire-and-forget（内部で非同期にハッシュ化して送信）にする。
export function trackEvent(
  name: TrackableEventName,
  attributes?: Record<string, string>,
  options?: TrackEventOptions,
): void {
  // 上限を超えた分は捨てる（レート制限到達自体を記録すると枠を消費する）。
  if (!rateLimiter.shouldAllow(options?.rateLimitKey ?? name)) return;
  const promise = send(name, attributes, options);
  pendingSends.add(promise);
  void promise.finally(() => pendingSends.delete(promise));
}

// 進行中のイベント送信が Sentry のログバッファへ乗るのを待つ。
// Web はページ遷移でバッファごと捨てられるため、遷移前にこれと
// Sentry.flush() を呼んで消失を防ぐ（issue #64 と同じ理由）。
export async function flushTrackedEvents(): Promise<void> {
  await Promise.all(pendingSends);
}

async function send(
  name: TrackableEventName,
  attributes: Record<string, string> | undefined,
  options: TrackEventOptions | undefined,
): Promise<void> {
  try {
    const attrs: Record<string, string> = { ...attributes };
    if (options?.autoAttributes ?? true) {
      attrs[TRACK_EVENT_ATTRS.name] = name;
      // beforeSend（finalizeEvent）はエラーイベントにだけ効くため、
      // ログ側では platform を属性として自分で付ける。
      attrs[TRACK_EVENT_ATTRS.platform] = Platform.OS;
      attrs[TRACK_EVENT_ATTRS.appVersion] =
        Constants.expoConfig?.version ?? "dev";
      const screen = options?.screen ?? eventContext.screen;
      if (screen) {
        attrs[TRACK_EVENT_ATTRS.screen] = screen;
      }
    }
    const rawUserId =
      options?.userId === undefined ? eventContext.userId : options.userId;
    if (rawUserId) {
      const userKey = await hashedUserKey(rawUserId);
      if (userKey) {
        attrs[options?.userKeyAttr ?? TRACK_EVENT_ATTRS.userKey] = userKey;
      }
    }
    Sentry.logger.info(name, attrs);
  } catch {
    // 計測送信の失敗は握りつぶす（UI 操作に影響させない）。
  }
}

// Clerk userId の生値を送らず、ソルト付き SHA-256 の先頭だけを擬似キーにする。
// ソルトは Annict ファネル計測（issue #64）から据え置く。変えると
// annict.user_key の過去分と値が変わって同一ユーザー追跡が切れる上、
// 共有することで UI イベントの user_key と突き合わせられる。
const USER_KEY_SALT = "animeishi-annict-funnel-v1:";
const USER_KEY_LENGTH = 16;

// 同一ユーザーのイベントごとに digest を取り直さないよう結果をキャッシュする。
const userKeyCache = new Map<string, Promise<string | undefined>>();

function hashedUserKey(userId: string): Promise<string | undefined> {
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
  // 失敗（undefined 解決）はキャッシュに残さない。残すと一時的な障害のあと
  // アプリ再起動まで user_key が付かなくなるため、次回イベントで再試行させる。
  void promise.then((value) => {
    if (value === undefined && userKeyCache.get(userId) === promise) {
      userKeyCache.delete(userId);
    }
  });
  return promise;
}

// テスト用。モジュールに保持するレート制限・コンテキスト・送信待ち・
// ハッシュキャッシュを初期化する。
export function resetEventTrackingForTest(): void {
  rateLimiter.reset();
  pendingSends.clear();
  eventContext.userId = undefined;
  eventContext.screen = undefined;
  userKeyCache.clear();
}
