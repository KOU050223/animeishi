/**
 * 近づけて交換で相手 1 人に送るメッセージ。ネイティブは暗号化した文字列を
 * 運ぶだけなので、種類の区別は JS で JSON の封筒にして行う。
 * - data: 交換データ（QR と同じ形の URL）
 * - request / accept / decline / cancel: タップで交換するときの申し込みと返事
 */
export type NearbyMessage =
  | { kind: "data"; url: string }
  | { kind: "request" }
  | { kind: "accept" }
  | { kind: "decline" }
  | { kind: "cancel" };

const VERSION = 1;
const SIGNAL_KINDS = new Set(["request", "accept", "decline", "cancel"]);

export function encodeNearbyMessage(message: NearbyMessage): string {
  return JSON.stringify({ v: VERSION, ...message });
}

/** 読めない・知らない種類のメッセージは null（無視する）。 */
export function decodeNearbyMessage(raw: string): NearbyMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { v, kind, url } = value as Record<string, unknown>;
  if (v !== VERSION || typeof kind !== "string") return null;
  if (kind === "data") {
    return typeof url === "string" ? { kind: "data", url } : null;
  }
  return SIGNAL_KINDS.has(kind) ? ({ kind } as NearbyMessage) : null;
}
