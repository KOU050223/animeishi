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
//   3. 全滅したら Kitsu で補完 URL を引き直してもう一度試す
//      （Kitsu の新しい作品は 15 分で失効する署名付き URL を返すため、
//      解決済みでも URL が死んでいる作品はここで再解決して救う）
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
import {
  IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS,
  isSnsImageUrl,
  resolveImagesForWorks,
} from "./imageFallback";

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
  //   1. resolvedImageUrl（Kitsu / MAL のポスター。縦長で統一感があり、
  //      CDN も安定している。Annict 側が使えないと分かった作品にしか無い）
  //   2. Annict の imageUrl（公式サイトの OG 画像が多く、古い作品はリンク切れが多い）
  //   3. http: の Annict URL を https に上げたもの（公式サイトの多くは https にも
  //      対応しており、Mixed Content で捨てていた画像を救える）
  const candidates: string[] = [];
  const push = (url: string | null | undefined) => {
    // 本番 DB に `&` が `&amp;` で入っている行があったため & に戻す。
    // そのままだと署名付き URL のパラメータ名が壊れて必ず失敗する。
    const trimmed = url?.trim().replace(/&amp;/g, "&");
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
  const input = stableUrlForHash(url);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * ハッシュ入力の正規化。署名付き URL（Kitsu の Backblaze B2 が返す
 * ?X-Amz-... 付きのもの）は再発行のたびにクエリが変わるため、署名パラメータを
 * 除いてからハッシュする。除かないと取り込み済みでも「取り込み元が変わった」
 * と毎回誤判定され、表示のたびに取り直しが走る。
 * `&amp;` でエスケープ済みの値が来ても同じキーに落ちるよう & に戻す。
 */
function stableUrlForHash(url: string): string {
  const unescaped = url.replace(/&amp;/g, "&");
  try {
    const parsed = new URL(unescaped);
    // URLSearchParams.keys() は生きたイテレータなので、消しながら回すと
    // 次のキーを飛ばしうる。先に配列化してから削除する。
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^x-amz-/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return unescaped;
  }
}

/** R2 キーの拡張子手前まで（`works/<annictWorkId>/<hash>`）。 */
function workImageKeyPrefix(annictWorkId: number, sourceUrl: string): string {
  return `works/${annictWorkId}/${sourceUrlHash(sourceUrl)}`;
}

/** R2 キー（`works/<annictWorkId>/<hash>.<ext>`）。 */
export function workImageKey(
  annictWorkId: number,
  sourceUrl: string,
  ext: string,
): string {
  return `${workImageKeyPrefix(annictWorkId, sourceUrl)}.${ext}`;
}

/**
 * その作品自身の画像キーか。形式だけでなく作品 ID まで照合する
 * （DB の値が別作品のキーを指していても、その画像を配信・削除しない）。
 */
function isOwnWorkImageKey(annictWorkId: number, key: string): boolean {
  return (
    WORK_IMAGE_KEY_PATTERN.test(key) && key.startsWith(`works/${annictWorkId}/`)
  );
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
 * R2 ヒット（取り込み元が今の候補と一致）→ そのまま返す /
 * ミス・取り込み元の差し替え → 候補を fetch して R2 に保存して返す。
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

  const candidates = workImageSourceCandidates(row);
  const inCooldown =
    row.imageR2AttemptedAt != null &&
    now.getTime() - row.imageR2AttemptedAt.getTime() <
      WORK_IMAGE_FAILURE_COOLDOWN_MS;

  // --- 1. 取り込み済み ---
  // 別作品のキーを指している行はキーが無いものとして扱う（配信も削除もしない）。
  const ownKey =
    row.imageR2Key && isOwnWorkImageKey(annictWorkId, row.imageR2Key)
      ? row.imageR2Key
      : null;
  const stored = ownKey ? await bucket.get(ownKey) : null;
  const storedResponse = () =>
    stored
      ? imageResponse(
          stored.body,
          stored.httpMetadata?.contentType ?? "application/octet-stream",
          stored.httpEtag,
        )
      : notFound();
  if (stored && ownKey) {
    // キーには取り込み元 URL のハッシュが入っている。今の候補のどれかと
    // 一致すれば最新。一致しなければ取り込み元が差し替わった（Annict の URL
    // 変更・MAL ID 変更による補完のやり直し等）ので取り込み直す。
    // 候補が 1 つも無い（上流の画像が消えた）場合は、無いよりマシなので
    // 取り込み済みの画像を返し続ける。
    const isFresh =
      candidates.length === 0 ||
      candidates.some((url) =>
        ownKey.startsWith(`${workImageKeyPrefix(annictWorkId, url)}.`),
      );
    // 取り込み直しはクールダウンに従う（取り込み成功時にも試行時刻が立つので、
    // 直近に取り込んだばかりの作品は叩き直さない）。
    if (isFresh || inCooldown) return storedResponse();
  }

  // --- クールダウン（直近に全候補が失敗した作品は外部を叩かない） ---
  // キーだけ残ってオブジェクトが消えている行はクールダウンに関わらず
  // 取り込みを試す（失敗すれば末尾でキーを外して試行時刻を立てるので、
  // 次回以降はここで止まる）。
  if (!stored && !ownKey && inCooldown) return notFound();

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

  let hit = await tryCandidates(candidates);

  // --- 3. 全滅なら Kitsu で補完 URL を引き直す ---
  // Annict の URL が「見た目はまとも・実体は 404」の作品は、検索経路でも cron
  // でも補完対象にならない（placeholder 判定は URL 文字列しか見ない）。
  // また Kitsu の新しい作品は 15 分で失効する署名付き URL を resolvedImageUrl
  // に持つため、解決済みでも URL が死んでいる作品がある。実際に取れなかった
  // ことが分かったここで MAL ID（無ければ Kitsu 作品 ID。issue #227 の
  // タイトル検索で採った行）から Kitsu を 1 回引き直し、得た新しい URL を
  // その場で取り込む（R2 に入れば以後は失効しても関係ない）。
  // 'none'（Kitsu にも無いことが確定済み）は TTL 内なら引き直さない。
  // TTL 切れならここでも 1 回引き直す — 'none' 確定後に Annict 側の URL が
  // 「見た目は正常だが実体は 404」に更新された作品は cron の pending 対象外
  // （非 placeholder URL は対象外）のため、ここが唯一の拾い直し経路になる。
  // 再解決結果は確定済みの 'none' を含めて書き戻し、resolvedAt を起点に
  // 次の再解決を TTL 分先送りする（cron と同じ扱い）。
  // Kitsu へのリクエスト自体の失敗は結果が返らないので書き込まない
  // （'none' に確定させず、クールダウン切れ後にまた試行される）。
  const noneResolutionStale =
    row.imageSource === "none" &&
    (row.resolvedAt == null ||
      now.getTime() - row.resolvedAt.getTime() >=
        IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS);
  if (
    !hit &&
    (row.malAnimeId != null || row.kitsuAnimeId != null) &&
    (row.imageSource !== "none" || noneResolutionStale)
  ) {
    const [resolved] = await resolveImagesForWorks(
      [
        {
          annictWorkId,
          malAnimeId: row.malAnimeId,
          kitsuAnimeId: row.kitsuAnimeId,
        },
      ],
      fetchImpl,
    );
    if (resolved) {
      await repo.updateResolvedImage(annictWorkId, {
        resolvedImageUrl: resolved.resolvedImageUrl,
        imageSource: resolved.imageSource,
        resolvedAt: now,
      });
      if (resolved.resolvedImageUrl) {
        hit = await tryCandidates(
          workImageSourceCandidates({
            imageUrl: row.imageUrl,
            resolvedImageUrl: resolved.resolvedImageUrl,
          }),
        );
      }
    }
  }

  if (!hit) {
    if (stored) {
      // 取り込み直しに失敗しただけなら、古い画像を返し続ける。
      await repo.markImageR2Attempted(annictWorkId, now);
      return storedResponse();
    }
    // キーだけ残ってオブジェクトが消えていた行（・別作品を指す行）はキーも外す
    // （外さないとクールダウンが効かず、表示のたびに外部を叩き直してしまう）。
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
  // 消すのはこの作品自身のキーだけ（別作品のオブジェクトには触れない）。
  if (ownKey && ownKey !== key) {
    await bucket.delete(ownKey).catch(() => {});
  }
  return imageResponse(hit.image.data, hit.image.contentType);
}
