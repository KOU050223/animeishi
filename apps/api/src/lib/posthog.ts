// サーバー側のプロダクト計測（issue #758）。成立をクライアントの送信に
// 頼ると送信漏れで率がぶれるイベント（SERVER_TRACKED_EVENTS）を、
// Worker から PostHog の capture API へ直接送る。
// POSTHOG_KEY（Workers Secret）が未設定なら何もしない。
// distinct_id は mobile の identify と同じ擬似キー（Clerk userId のソルト付き
// ハッシュ）にして、同一ユーザーのイベントとして突き合わせられるようにする。
import type { Context } from "hono";
import {
  resolveEnvironment,
  userKeyDigestInput,
  userKeyFromDigest,
  type ServerTrackedEventName,
} from "@animeishi/observability";

// mobile の DEFAULT_POSTHOG_HOST（apps/mobile/lib/analytics/client.ts）と揃える。
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export type PostHogBindings = {
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
  ENVIRONMENT?: string;
};

export async function hashedUserKey(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userKeyDigestInput(userId)),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return userKeyFromDigest(hex);
}

// 送信に失敗しても reject しない（応答・本体処理に影響させない）。
export async function sendServerEvent(
  env: PostHogBindings,
  event: ServerTrackedEventName,
  userId: string,
  properties: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const apiKey = env.POSTHOG_KEY?.trim();
  if (!apiKey) return false;
  const host = (env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST).replace(
    /\/+$/,
    "",
  );
  try {
    const res = await fetchImpl(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: await hashedUserKey(userId),
        timestamp: new Date().toISOString(),
        properties: {
          ...properties,
          environment: resolveEnvironment(env.ENVIRONMENT),
          platform: "server",
          // 送信元は Worker（Cloudflare の IP）なので、利用者の所在地として
          // GeoIP を引かせない。
          $geoip_disable: true,
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ルートハンドラから呼ぶ。応答は待たせず waitUntil で送る。
export function captureServerEvent(
  c: Context,
  event: ServerTrackedEventName,
  userId: string,
  properties?: Record<string, string>,
): void {
  const env = (c.env ?? {}) as PostHogBindings;
  if (!env.POSTHOG_KEY?.trim()) return;
  const task = sendServerEvent(env, event, userId, properties);
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    // ExecutionContext の無い環境（テストの app.request 等）。
    // sendServerEvent は reject しないのでそのまま流す。
  }
}
