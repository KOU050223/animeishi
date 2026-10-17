// 作品画像の読み通しプロキシ（GET /images/works/:annictWorkId）。
//
// 背景: 以前は cron が今期・来期の作品画像を R2 へ事前取り込みしていた
// （issue #174）が、シーズン表記の不一致（DB は "AUTUMN" + season_year、
// 取り込み側は "2026-autumn"）で本番では 1 件も取り込まれていなかった。
// また Annict の画像 URL は「文字列としてはまともでも実体は 404」の作品が
// 多く、URL の見た目だけで placeholder 判定する方式では欠損を拾えなかった。
//
// そこで「表示されたときに実際に取りに行き、取れたものを R2 に保存する」
// 読み通し方式にする:
//   1. R2 に取り込み済みならそれを返す
//   2. 無ければ候補 URL（workImageSourceCandidates）を順に fetch し、
//      最初に画像が返ったものを R2 に保存して返す
//   3. 全滅したら AniList で補完 URL を引き直して（未解決時のみ）もう一度試す
//   4. それでもダメなら 404。試行時刻を立て、クールダウン中は外部を叩かない
// 季節で対象を絞らないので過去作品も同じ経路で救える。
//
// クライアントに渡す URL は作品単位で安定（/images/works/<id>）なので、
// 取り込み元が変わってもクライアント側は何も変えなくてよい。
// その代わり immutable にはできないため、短めの max-age で返す。
//
// バケットはアバター用の AVATARS（animeishi-avatars）を `works/` プレフィックスで
// 共有する。アカウント削除時の掃除は `avatars/` 配下のみ対象なので混ざらない。

import type { DrizzleDb } from "@/db/client";
import { worksRepository } from "@/features/works/repository";
import {
  fetchFollowingRedirects,
  isPublicImageUrl,
  readBodyWithLimit,
} from "@/lib/http";
import { isSnsImageUrl, resolveImagesViaAnilist } from "./imageFallback";

/** 全候補が失敗した作品で、外部 fetch を再試行するまでの間隔。 */
export const WORK_IMAGE_FAILURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const IMAGE_FETCH_TIMEOUT_MS = 8000;
const IMAGE_FETCH_MAX_REDIRECTS = 3;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// 取り込み済み画像のキャッシュ期間。URL が作品単位で安定しているため
// immutable にはできない（取り込み元が差し替わる可能性がある）。
const HIT_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=604800";
// 画像なしの 404 は短めにキャッシュする（補完が進めば早めに拾い直せるように）。
const MISS_CACHE_CONTROL = "public, max-age=300";

// 配信許可する Content-Type → キーの拡張子。
// SVG はスクリプトを含み得るため対象外（same-origin 配信で XSS 化しうる）。
// AVIF も対象外にする。RN の <Image> が描画できるか環境依存のため、
// 取り込み済みなのに表示されないケースを生み得る。
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const WORK_IMAGE_PATH_PREFIX = "/images/works/";

// works/<annictWorkId>/<hash>.<ext> 以外のキーは読み書きしない
// （DB 由来の値に異常値が混ざっても avatars/ 等へ到達しないように）。
const WORK_IMAGE_KEY_PATTERN =
  /^works\/\d+\/[0-9a-f]+\.(?:jpe?g|png|webp|gif)$/i;

/**
 * 作品画像の取り込み元候補を優先順で返す（先頭から順に fetch を試す）。
 * fetch 先は https の公開ホストに限定すること（SSRF 対策。isPublicImageUrl）。
 */
export function workImageSourceCandidates(row: {
  imageUrl: string | null | undefined;
  resolvedImageUrl: string | null | undefined;
}): string[] {
  // 優先順:
  //   1. resolvedImageUrl（AniList / MAL のポスター。縦長で統一感があり、
  //      CDN も安定している。Annict 側が使えないと分かった作品にしか無い）
  //   2. Annict の imageUrl（公式サイトの OG 画像が多く、古い作品はリンク切れが多い）
  //   3. http: の Annict URL を https に上げたもの（公式サイトの多くは https にも
  //      対応しており、Mixed Content で捨てていた画像を救える）
  const candidates: string[] = [];
  const push = (url: string | null | undefined) => {
    const trimmed = url?.trim();
    if (!trimmed || isSnsImageUrl(trimmed) || !isPublicImageUrl(trimmed))
      return;
    if (!candidates.includes(trimmed)) candidates.push(trimmed);
  };
  push(row.resolvedImageUrl);
  push(row.imageUrl);
  if (row.imageUrl && /^http:/i.test(row.imageUrl.trim())) {
    push(row.imageUrl.trim().replace(/^http:/i, "https:"));
  }
  return candidates;
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

/** R2 キー（`works/<annictWorkId>/<hash>.<ext>`）。 */
export function workImageKey(
  annictWorkId: number,
  sourceUrl: string,
  ext: string,
): string {
  return `works/${annictWorkId}/${sourceUrlHash(sourceUrl)}.${ext}`;
}

/**
 * 作品画像の配信 URL を組み立てる（リクエスト先オリジンに載せる）。
 * 画像の有無に関わらず返す。取り込めない作品はプロキシが 404 を返し、
 * クライアントはプレースホルダー（または外部 URL）に落ちる。
 */
export function workImageUrl(
  requestUrl: string,
  annictWorkId: number | null | undefined,
): string | null {
  if (annictWorkId == null || !Number.isSafeInteger(annictWorkId)) return null;
  try {
    const url = new URL(requestUrl);
    url.pathname = `${WORK_IMAGE_PATH_PREFIX}${annictWorkId}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

type FetchedImage = { data: ArrayBuffer; contentType: string; ext: string };

/**
 * 外部の画像 URL を取得して検証する。失敗・非画像・サイズ超過はすべて null。
 */
async function fetchWorkImage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<FetchedImage | null> {
  if (!isPublicImageUrl(url)) return null;
  // リダイレクトは manual で 1 ホップずつ追い、遷移先にも同じ公開ホスト検証を
  // かける（redirect: "follow" のまま内部宛先へ連れて行かれる SSRF を防ぐ）。
  let followed;
  try {
    followed = await fetchFollowingRedirects(url, {
      timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
      maxRedirects: IMAGE_FETCH_MAX_REDIRECTS,
      isAllowed: isPublicImageUrl,
      fetchImpl,
    });
  } catch {
    return null;
  }
  if (followed.kind !== "final") return null;
  const res = followed.response;
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

function imageResponse(
  body: ReadableStream | ArrayBuffer,
  contentType: string,
  etag?: string,
): Response {
  const headers = new Headers();
  headers.set("content-type", contentType);
  if (etag) headers.set("etag", etag);
  headers.set("cache-control", HIT_CACHE_CONTROL);
  // Content-Type は取り込み時に画像系のみ許可しているが、配信経路でも
  // ブラウザの MIME スニッフィングを抑止しておく。
  headers.set("x-content-type-options", "nosniff");
  return new Response(body, { headers });
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: {
      "content-type": "application/json",
      "cache-control": MISS_CACHE_CONTROL,
    },
  });
}

/**
 * GET /images/works/:annictWorkId の本体。
 * R2 ヒット → そのまま返す / ミス → 候補を fetch して R2 に保存して返す。
 */
export async function serveWorkImage(
  db: DrizzleDb,
  bucket: R2Bucket,
  annictWorkId: number,
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const repo = worksRepository(db);

  const row = await repo.getAnnictWorkById(annictWorkId);
  if (!row) return notFound();

  // --- 1. 取り込み済み ---
  if (row.imageR2Key && WORK_IMAGE_KEY_PATTERN.test(row.imageR2Key)) {
    const object = await bucket.get(row.imageR2Key);
    if (object) {
      return imageResponse(
        object.body,
        object.httpMetadata?.contentType ?? "application/octet-stream",
        object.httpEtag,
      );
    }
    // キーはあるがオブジェクトが消えている → 取り込み直す。
  }

  // --- クールダウン（直近に全候補が失敗した作品は外部を叩かない） ---
  if (
    !row.imageR2Key &&
    row.imageR2AttemptedAt &&
    now.getTime() - row.imageR2AttemptedAt.getTime() <
      WORK_IMAGE_FAILURE_COOLDOWN_MS
  ) {
    return notFound();
  }

  // --- 2. 候補を順に取りに行く ---
  const tried = new Set<string>();
  const tryCandidates = async (candidates: string[]) => {
    for (const url of candidates) {
      if (tried.has(url)) continue;
      tried.add(url);
      const image = await fetchWorkImage(url, fetchImpl);
      if (image) return { url, image };
    }
    return null;
  };

  let hit = await tryCandidates(workImageSourceCandidates(row));

  // --- 3. 全滅なら AniList で補完 URL を引き直す ---
  // Annict の URL が「見た目はまとも・実体は 404」の作品は、検索経路でも cron
  // でも補完対象にならない（placeholder 判定は URL 文字列しか見ない）。
  // 実際に取れなかったことが分かったここで、未解決なら AniList を 1 回引く。
  // Jikan は遅く（直列・レート制限）画像リクエストの応答を待たせるため、
  // ここでは叩かず cron の補完に任せる。
  if (!hit && row.malAnimeId != null && !row.resolvedImageUrl) {
    const [resolved] = await resolveImagesViaAnilist(
      [{ annictWorkId, malAnimeId: row.malAnimeId }],
      fetchImpl,
    );
    if (resolved?.resolvedImageUrl) {
      await repo.updateResolvedImage(annictWorkId, {
        resolvedImageUrl: resolved.resolvedImageUrl,
        imageSource: resolved.imageSource,
        resolvedAt: now,
      });
      hit = await tryCandidates(
        workImageSourceCandidates({
          imageUrl: row.imageUrl,
          resolvedImageUrl: resolved.resolvedImageUrl,
        }),
      );
    }
  }

  if (!hit) {
    // キーだけ残ってオブジェクトが消えていた行はキーも外す（外さないと
    // クールダウンが効かず、表示のたびに外部を叩き直してしまう）。
    if (row.imageR2Key) {
      await repo.updateImageR2Key(annictWorkId, null, now);
    } else {
      await repo.markImageR2Attempted(annictWorkId, now);
    }
    return notFound();
  }

  // --- 保存して返す ---
  const key = workImageKey(annictWorkId, hit.url, hit.image.ext);
  await bucket.put(key, hit.image.data, {
    httpMetadata: { contentType: hit.image.contentType },
  });
  await repo.updateImageR2Key(annictWorkId, key, now);
  // 取り込み元が変わって残った旧オブジェクトは消す（参照されないゴミを増やさない）。
  if (
    row.imageR2Key &&
    row.imageR2Key !== key &&
    WORK_IMAGE_KEY_PATTERN.test(row.imageR2Key)
  ) {
    await bucket.delete(row.imageR2Key).catch(() => {});
  }
  return imageResponse(hit.image.data, hit.image.contentType);
}
