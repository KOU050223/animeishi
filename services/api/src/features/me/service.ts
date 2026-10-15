// アバターとして許可する画像形式と拡張子の対応。
// モバイル側は WebP に圧縮して送るが、フォールバックも許容する。
export const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

// アバター画像の最大サイズ（5MB）。512px に圧縮済みの WebP なら十分収まる。
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// アバター配信パスの接頭辞。URL からの R2 キー復元・配信ハンドラで共有する。
export const AVATAR_PATH_PREFIX = "/me/profile/avatar/";

// 名刺エディタの任意画像（POST /me/meishi-assets）の上限・配信パス・R2 キー接頭辞。
// アバターと同じ AVATARS バケットに meishi-assets/ プレフィックスで分けて置く
// （docs/06: 任意アップロード画像は R2 に個別アップロード）。
export const MEISHI_ASSET_MAX_BYTES = 500 * 1024;
export const MEISHI_ASSET_PATH_PREFIX = "/me/meishi-assets/";
export const MEISHI_ASSET_KEY_PREFIX = "meishi-assets/";
// 要素削除・差し替えでオーファン化したオブジェクトも残るため、
// ストレージが無制限に増えないよう 1 ユーザーあたりの件数に緩い上限を設ける。
export const MEISHI_ASSET_MAX_PER_USER = 200;

/**
 * アバター配信 URL（または同形式のパス）から R2 オブジェクトキーを復元する。
 * 不正な URL や対象外パスの場合は null を返す（旧画像の削除をスキップするため）。
 */
export function avatarKeyFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(AVATAR_PATH_PREFIX)) return null;
  try {
    const key = decodeURIComponent(pathname.slice(AVATAR_PATH_PREFIX.length));
    return key.startsWith("avatars/") ? key : null;
  } catch {
    return null;
  }
}

/** 名刺アセット配信パスから R2 オブジェクトキーを復元する。 */
export function meishiAssetKeyFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(MEISHI_ASSET_PATH_PREFIX)) return null;
  try {
    const key = decodeURIComponent(
      pathname.slice(MEISHI_ASSET_PATH_PREFIX.length),
    );
    return key.startsWith(MEISHI_ASSET_KEY_PREFIX) ? key : null;
  } catch {
    // malformed なパーセントエンコードは URIError になるため 404 扱いに倒す
    return null;
  }
}

// R2 オブジェクトを画像レスポンスとして返す。画像はキー単位でイミュータブル
// （アップロードごとに新キー）なため長期キャッシュ可。
export function r2ImageResponse(object: R2ObjectBody): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}
