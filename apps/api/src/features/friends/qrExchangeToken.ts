// 対面 QR 交換専用の短期トークン（issue #417 レビュー対応）。
// POST /me/friends の即時成立は「相手が画面に出した QR を読んだ」証跡として
// このトークンを要求する。無しなら誰でも相手の同意なしにフレンドを成立
// でき、friend-requests の申請→承認を迂回できる。
//
// 新しい Workers Secret を増やせないため、署名鍵には既存の CLERK_SECRET_KEY を
// 使い、署名メッセージの先頭に用途名を入れてドメイン分離する
// （HMAC の鍵を別用途に流用しない設計。Clerk 側の検証と署名対象が
// 混ざることはない）。
//
// 形式: `${exp}.${base64url(sig)}`
//   sig = HMAC-SHA256(CLERK_SECRET_KEY, "animeishi-qr-exchange-v1:${userId}:${exp}")
// userId は QR を表示した側（addFriend の friendId になる相手）の ID。

const encoder = new TextEncoder();

/** トークンの有効期間（秒）。対面で画面を見せて読み合う用途なので短くする。 */
export const QR_EXCHANGE_TOKEN_TTL_SEC = 300;

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(buf);
}

const message = (userId: string, exp: number) =>
  `animeishi-qr-exchange-v1:${userId}:${exp}`;

/**
 * userId の QR に埋め込む交換トークンを発行する。
 * 呼び出し側は userId = 認証ユーザー（自分の QR 用）に限定すること。
 */
export async function issueQrExchangeToken(
  secret: string,
  userId: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number }> {
  const exp = nowSec + QR_EXCHANGE_TOKEN_TTL_SEC;
  const sig = await hmac(secret, message(userId, exp));
  return { token: `${exp}.${base64url(sig)}`, expiresAt: exp };
}

// 時間依存を避けた固定長比較。長さが違うものは早期に弾く（長さ自体は秘密でない）。
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** token が userId 宛に発行された有効期限内のものかを検証する。 */
export async function verifyQrExchangeToken(
  secret: string,
  userId: string,
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  // 期限切れ・壊れた exp・追加区切りを含む形式異常はまとめて拒否。
  if (
    !Number.isSafeInteger(exp) ||
    exp <= nowSec ||
    token.indexOf(".", dot + 1) >= 0
  ) {
    return false;
  }
  const sigB64 = token.slice(dot + 1);
  let actual: Uint8Array;
  try {
    const bin = atob(sigB64.replace(/-/g, "+").replace(/_/g, "/"));
    actual = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) actual[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }
  const expected = await hmac(secret, message(userId, exp));
  return safeEqual(actual, expected);
}
