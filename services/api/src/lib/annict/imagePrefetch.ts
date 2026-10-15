// 作品画像の R2 事前取り込み（issue #174）。
//
// 背景: Annict / AniList / MAL 等の外部 CDN の画像 URL をそのまま
// クライアントへ返すと、初回表示が外部ホストの応答・ホットリンク制限・
// CDN キャッシュ状態に左右され、「一度キャッシュされるまで画像が出ない」
// 事象が実機で出ていた。cron が対象シーズンの作品画像を外部から取得して
// R2 へ保存し、GET /images/works/... の自前 URL で配信することで、
// 初回から安定して表示されるようにする。
//
// 取り込み元 URL の優先順位は表示側（apps/mobile/lib/anime/pickImageUrl.ts）と
// 揃える:
//   1. 実画像の imageUrl（Annict 由来・https かつ非 placeholder）
//   2. resolvedImageUrl（imageFallback が AniList / Jikan で解決した URL）
//   3. http: の imageUrl（表示側では placeholder 扱い＝Mixed Content 回避だが、
//      R2 に取り込めば https で配信できるため対象に含める）
// SNS アバター等の placeholder は作品画像ではないので取り込まない。
//
// R2 オブジェクトキーは `works/<annictWorkId>/<hash(sourceUrl)>.<ext>`。
// 取り込み元 URL のハッシュをキーに含めることで、
//   * 同一ソースの再取り込みを skip できる（キー一致 = 最新）
//   * 取り込み元が差し替わった作品（AniList 解決で URL が変わった等）だけ
//     自動で再取り込みされる
// キーが URL にそのまま載るため、配信は immutable にできる。
//
// バケットはアバター用の AVATARS（animeishi-avatars）を `works/` プレフィックスで
// 共有する。新規バケットは作らない。アカウント削除時の掃除は `avatars/` 配下のみ
// 対象なので混ざらない。

import { mapWithConcurrency } from "@animeishi/danime-core";
import type { DrizzleDb } from "@/db/client";
import { authorizedDb } from "@/repository/authorizedDb";
import { readBodyWithLimit } from "@/lib/http";
import { currentAnnictSeason, nextAnnictSeason } from "./client";
import { isPlaceholderImageUrl, isSnsImageUrl } from "./imageFallback";

/** 取り込み（または対象判定）の再試行間隔。失敗・取り込み元なしを短周期で叩き直さないためのもの。 */
export const IMAGE_PREFETCH_ATTEMPT_COOLDOWN_MS = 60 * 60 * 1000;

export function imagePrefetchAttemptStaleBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - IMAGE_PREFETCH_ATTEMPT_COOLDOWN_MS);
}

// 1 回の実行で走査する行数 / 実際に画像を fetch する件数。
// 画像の取得は 1 作品 = 1 サブリクエストで、同一 cron 内で動く画像 URL 解決
// （imageFallbackPending・40 件）のサブリクエストと加算される。Workers の
// サブリクエスト上限（50/invocation）に収まるよう取り込みは控えめに区切る。
// 未処理分は次回実行（試行時刻の古い順）に回るため収束は緩やかだが確実。
const PREFETCH_SCAN_LIMIT = 60;
const PREFETCH_FETCH_LIMIT = 10;
const PREFETCH_FETCH_CONCURRENCY = 5;

const IMAGE_FETCH_TIMEOUT_MS = 8000;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// 配信許可する Content-Type → キーの拡張子。
// SVG はスクリプトを含み得るため対象外（same-origin 配信で XSS 化しうる）。
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

// 配信パスと R2 キーの対応: GET /images/<key>。
export const WORK_IMAGE_PATH_PREFIX = "/images/";

// works/<annictWorkId>/<hash>.<ext> 以外のキーは配信しない
// （avatars/ 等の他用途オブジェクトへの到達を遮る）。
const WORK_IMAGE_KEY_PATTERN =
  /^works\/\d+\/[0-9a-f]+\.(?:jpe?g|png|webp|gif|avif)$/i;

const SYSTEM_USER_ID = "__image_prefetch_cron__";

// http(s) 以外のスキーム（javascript: や data:）は外部データ由来の文字列に
// 紛れ込み得るため、取り込み対象からは外す（fetch は data: も解釈する）。
function isFetchableImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * R2 へ取り込む画像のソース URL を選ぶ。優先順位はクライアントの
 * pickImageUrl（表示側）と揃える。取り込み不能なら null。
 */
export function pickWorkImageSource(
  imageUrl: string | null | undefined,
  resolvedImageUrl: string | null | undefined,
): string | null {
  if (
    imageUrl &&
    isFetchableImageUrl(imageUrl) &&
    !isPlaceholderImageUrl(imageUrl)
  ) {
    return imageUrl;
  }
  if (resolvedImageUrl && isFetchableImageUrl(resolvedImageUrl)) {
    return resolvedImageUrl;
  }
  // ここに来る imageUrl は placeholder（null/空/http:/SNS）のいずれか。
  // このうち http: の実画像だけは取り込み価値がある（https 配信に化ける）。
  const trimmed = imageUrl?.trim();
  if (trimmed && isFetchableImageUrl(trimmed) && !isSnsImageUrl(trimmed)) {
    return trimmed;
  }
  return null;
}

// source URL → キー埋め込み用ハッシュ。FNV-1a（32bit）。
// 暗号強度は不要（同一作品の「取り込み元が変わったか」の検出だけに使う）。
function sourceUrlHash(url: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * R2 キーの拡張子手前まで（`works/<annictWorkId>/<hash>`）。
 * 拡張子は取得した画像の Content-Type で決まるため別枠。
 */
export function workImageKeyPrefix(
  annictWorkId: number,
  sourceUrl: string,
): string {
  return `works/${annictWorkId}/${sourceUrlHash(sourceUrl)}`;
}

/** 配信 URL（または絶対 URL のパス）から R2 キーを復元する。対象外・不正は null。 */
export function workImageKeyFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(WORK_IMAGE_PATH_PREFIX)) return null;
  let key: string;
  try {
    key = decodeURIComponent(pathname.slice(WORK_IMAGE_PATH_PREFIX.length));
  } catch {
    // 不正な % エスケープ列（/images/% 等）は decodeURIComponent が投げる。
    return null;
  }
  return WORK_IMAGE_KEY_PATTERN.test(key) ? key : null;
}

/**
 * R2 キーから配信 URL を組み立てる（リクエスト先オリジンに載せる）。
 * cron 実行時にはリクエスト URL が無いためキーのみ DB に保存し、
 * URL への展開はレスポンス生成時に行う。
 */
export function hostedWorkImageUrl(
  requestUrl: string,
  imageR2Key: string | null | undefined,
): string | null {
  if (!imageR2Key) return null;
  try {
    const url = new URL(requestUrl);
    url.pathname = `${WORK_IMAGE_PATH_PREFIX}${imageR2Key}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

type FetchedImage = { data: ArrayBuffer; contentType: string; ext: string };

/**
 * 外部の画像 URL を取得して検証する。失敗・非画像・サイズ超過はすべて null
 * （呼び出し側は attempted を立てて次回に回す）。
 */
async function fetchWorkImage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<FetchedImage | null> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = CONTENT_TYPE_TO_EXT[contentType];
  if (!ext) return null;
  // content-length が分かっている時点で超過ならボディを読まずに捨てる。
  const declaredLength = Number(res.headers.get("content-length") ?? 0);
  if (declaredLength > IMAGE_MAX_BYTES) return null;
  const read = await readBodyWithLimit(res.body, IMAGE_MAX_BYTES);
  if (!read.ok) return null;
  return { data: read.data, contentType, ext };
}

export type PrefetchWorkImagesResult = {
  /** 対象として走査した行数 */
  scanned: number;
  /** 今回新たに R2 へ保存した件数 */
  stored: number;
  /** fetch / 保存に失敗した件数 */
  failed: number;
};

/**
 * 今期・来期シーズンの作品画像を R2 へ取り込む（cron 用・best effort）。
 *
 * - scan: season_name が今期・来期で画像 URL を持ち、最終試行から
 *   クールダウンが経過した行を最大 scanLimit 件取得する。
 * - skip: キーが既に最新（取り込み元のハッシュ一致）なら何もしない。
 * - fetch: 新規・ソース差し替え分だけ外部 fetch して R2 へ保存し
 *   image_r2_key を更新する。上限 fetchLimit 件（サブリクエスト制約）。
 * - 確認・失敗した行にも attempted を立てる（クールダウン）。
 */
export async function prefetchWorkImages(
  db: DrizzleDb,
  bucket: R2Bucket,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
    scanLimit?: number;
    fetchLimit?: number;
  } = {},
): Promise<PrefetchWorkImagesResult> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const scanLimit = options.scanLimit ?? PREFETCH_SCAN_LIMIT;
  const fetchLimit = options.fetchLimit ?? PREFETCH_FETCH_LIMIT;
  const adb = authorizedDb(db, SYSTEM_USER_ID);

  const rows = await adb.getImagePrefetchTargets(
    [currentAnnictSeason(now), nextAnnictSeason(now)],
    imagePrefetchAttemptStaleBefore(now),
    scanLimit,
  );
  if (rows.length === 0) return { scanned: 0, stored: 0, failed: 0 };

  type Job = {
    annictWorkId: number;
    sourceUrl: string;
    keyPrefix: string;
    previousKey: string | null;
  };
  const jobs: Job[] = [];
  // 取り込み不要（キーが最新）・取り込み元なしの行も「確認済み」として
  // attempted を立てる。立てないと毎回の走査で先頭を占め続け、
  // 後続の未取り込み作品に順番が回らなくなる。
  const checkedIds: number[] = [];

  for (const row of rows) {
    const sourceUrl = pickWorkImageSource(row.imageUrl, row.resolvedImageUrl);
    if (!sourceUrl) {
      checkedIds.push(row.annictWorkId);
      continue;
    }
    const keyPrefix = workImageKeyPrefix(row.annictWorkId, sourceUrl);
    if (row.imageR2Key?.startsWith(`${keyPrefix}.`)) {
      checkedIds.push(row.annictWorkId);
      continue;
    }
    // fetchLimit を超えた分は attempted を立てず次回優先に残す
    // （未試行 = ORDER BY 先頭側に残るので次の実行で拾われる）。
    if (jobs.length < fetchLimit) {
      jobs.push({
        annictWorkId: row.annictWorkId,
        sourceUrl,
        keyPrefix,
        previousKey: row.imageR2Key,
      });
    }
  }

  let stored = 0;
  const failedIds: number[] = [];
  await mapWithConcurrency(jobs, PREFETCH_FETCH_CONCURRENCY, async (job) => {
    try {
      const image = await fetchWorkImage(job.sourceUrl, fetchImpl);
      if (!image) {
        failedIds.push(job.annictWorkId);
        return;
      }
      const key = `${job.keyPrefix}.${image.ext}`;
      // 保存 → DB 更新の順。DB 更新が失敗しても画像は immutable キーに
      // 残るだけで、次回実行で同一ソースならキー一致でスキップされる。
      await bucket.put(key, image.data, {
        httpMetadata: { contentType: image.contentType },
      });
      await adb.updateImageR2Key(job.annictWorkId, key, now);
      // ソース差し替えで残った旧キーのオブジェクトは消す
      // （残っていても参照されないだけだが、ゴミを増やさないため）。
      if (job.previousKey && job.previousKey !== key) {
        await bucket.delete(job.previousKey).catch(() => {});
      }
      stored++;
    } catch (err) {
      failedIds.push(job.annictWorkId);
      console.error(
        JSON.stringify({
          level: "warn",
          event: "work_image_prefetch_failed",
          annictWorkId: job.annictWorkId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  // 確認済み（最新・取り込み元なし・失敗）の行に試行時刻を立てる。
  // 取り込み成功は updateImageR2Key が attempted も立てるので除外。
  const attemptedIds = [...checkedIds, ...failedIds];
  if (attemptedIds.length > 0) {
    await adb.markImagePrefetchAttempted(attemptedIds, now);
  }

  return { scanned: rows.length, stored, failed: failedIds.length };
}
