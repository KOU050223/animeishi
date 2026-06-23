/**
 * QR コードに埋め込まれたユーザー ID を抽出するパーサー。
 *
 * カメラやネイティブ API に依存しない純粋関数として実装しているため、
 * iOS / Android / Web のどのクライアントでも同じロジックが動作し、
 * Jest で一度テストすれば全環境での挙動が保証される。
 *
 * 対応フォーマット（docs/01 PR8 仕様）:
 *  1. 旧 URL        : https://animeishi-viewer.web.app/user/{uid} など任意ホストの /user/{uid}
 *  2. カスタムスキーム: animeishi://user/{uid} / animeishi://{uid}
 *  3. 生 UID         : Clerk ID (user_xxxxx) または旧 Firebase 28 文字 UID
 *
 * ホスト名はハードコードせず「パス末尾の UID を取り出す」寛容な実装にしているため、
 * 将来 Web 版の URL が変わってもパーサーを書き換える必要はない。
 */

/** Clerk のユーザー ID（user_ + base58 英数字）。 */
const CLERK_ID_PATTERN = /^user_[0-9A-Za-z]+$/;

/** 旧 Firebase の 28 文字 UID（英数字）。 */
const LEGACY_UID_PATTERN = /^[0-9A-Za-z]{28}$/;

/** 抽出候補が有効なユーザー ID かどうかを判定する。 */
function isValidUserId(value: string): boolean {
  return CLERK_ID_PATTERN.test(value) || LEGACY_UID_PATTERN.test(value);
}

/**
 * スキャン / 入力された文字列からユーザー ID を抽出する。
 * 抽出できない場合は null を返す。
 */
export function parseUserIdFromQr(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. そのものが UID（生 UID フォーマット）
  if (isValidUserId(trimmed)) return trimmed;

  // 2. URL / スキームとしてパスを分解し、末尾セグメントから UID を探す。
  const candidate = extractFromUrlLike(trimmed);
  if (candidate && isValidUserId(candidate)) return candidate;

  return null;
}

/**
 * URL もしくはカスタムスキーム文字列からユーザー ID 候補を取り出す。
 * `/user/{uid}` パターンを優先し、なければパス末尾セグメントを候補とする。
 */
function extractFromUrlLike(input: string): string | null {
  // クエリ・フラグメントを除去
  const withoutQuery = input.split(/[?#]/, 1)[0];

  // スキーム（animeishi://, https://）以降のパス部分を取得
  const schemeStripped = withoutQuery.replace(
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//,
    "",
  );

  // パスセグメントに分解（空要素は除外）
  const segments = schemeStripped.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // `/user/{uid}` 形式を優先
  const userIdx = segments.lastIndexOf("user");
  if (userIdx >= 0 && userIdx + 1 < segments.length) {
    return segments[userIdx + 1];
  }

  // それ以外はパス末尾を候補にする（animeishi://{uid} 等）
  return segments[segments.length - 1] ?? null;
}
