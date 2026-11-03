import { isValidUserId } from "@/lib/qrParser";

/**
 * 他アプリから共有されたテキスト / URL、および名刺 QR の画像から
 * 読み取った文字列から、Animeishi 名刺のユーザー ID を抽出する。
 * 抽出できない（Animeishi の名刺ではない）場合は null を返す（issue #316）。
 *
 * QR スキャン（lib/qrParser.ts）は旧 URL との後方互換のため任意ホストの
 * /user/{uid} を許すが、共有の受け口は「Animeishi の名刺だけ」を受け付ける
 * 仕様のため、こちらは buildProfileUrl が生成する形式に限定する:
 *   - 生 UID（Clerk ID / 旧 Firebase 28 文字 UID）
 *   - animeishi://user/{uid} / animeishi://{uid}
 *   - {EXPO_PUBLIC_WEB_URL}/user/{uid}
 */
export function extractUserIdFromSharedText(
  raw: string | null | undefined,
  webBaseUrl: string | null | undefined = process.env.EXPO_PUBLIC_WEB_URL,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 「この名刺: https://...」のように文に埋め込まれた URL も拾うため、
  // 空白区切りの各トークンを候補として試す。
  for (const token of trimmed.split(/\s+/)) {
    const userId = extractFromCandidate(token, webBaseUrl);
    if (userId) return userId;
  }
  return null;
}

function extractFromCandidate(
  input: string,
  webBaseUrl: string | null | undefined,
): string | null {
  if (isValidUserId(input)) return input;

  const url = tryParseUrl(input);
  if (!url) return null;

  if (url.protocol === "animeishi:") {
    return extractFromSchemeUrl(url);
  }

  if ((url.protocol === "https:" || url.protocol === "http:") && webBaseUrl) {
    const base = tryParseUrl(webBaseUrl);
    if (base && url.host === base.host) {
      return extractUserPathSegment(url);
    }
  }
  return null;
}

/** animeishi://user/{uid} と animeishi://{uid} の両方を受理する。 */
function extractFromSchemeUrl(url: URL): string | null {
  const segments = [url.hostname, ...url.pathname.split("/")].filter(Boolean);
  const candidate =
    segments.length === 1
      ? segments[0]
      : segments.length === 2 && segments[0] === "user"
        ? segments[1]
        : null;
  return candidate && isValidUserId(candidate) ? candidate : null;
}

/** {webBase}/user/{uid} だけを受理する。パスの深い URL は名刺ではない。 */
function extractUserPathSegment(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0] !== "user") return null;
  const candidate = safeDecode(segments[1]);
  return isValidUserId(candidate) ? candidate : null;
}

function tryParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
