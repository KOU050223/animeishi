// 作品画像の配信（GET /images/works/:annictWorkId）。
//
// 背景: 以前は cron が今期・来期の作品画像を R2 へ事前取り込みしていた
// （issue #174）が、シーズン表記の不一致（DB は "AUTUMN" + season_year、
// 取り込み側は "2026-autumn"）で本番では 1 件も取り込まれていなかった。
// また Annict の画像 URL は「文字列としてはまともでも実体は 404」の作品が
// 多く、URL の見た目だけで placeholder 判定する方式では欠損を拾えなかった。
//
// 配信時は Kitsu / MAL の解決済み画像、再解決した画像を優先して R2 に保存する。
// Annict の画像 URL は API 利用規約 第 10 条の「再配布」禁止に当たりやすいため
// R2 には保存せず（issue #559 案 B / #636）、実体が画像として取得できたときだけ
// 302 で元 URL へ誘導する。どれも使えなければ 404 を返す。
// 季節で対象を絞らないので過去作品も同じ経路で救える。
//
// Annict URL の検証は表示のたびに行うと公式サイトへ fetch が繰り返されるため、
// 検証できた URL のキー（works/<id>/<URL ハッシュ>.<ext>）を R2 オブジェクトを
// 置かずに image_r2_key へ記録し、以後はキーの照合だけでリダイレクトする。
// image_r2_key は「R2 オブジェクトのキー」または「検証済み Annict URL の記録」
// のどちらかを持つ。記録から一定期間が経つか、記録後に補完 URL が更新された
// 場合は取り直し・再検証に戻る。
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
  IMAGE_SOURCE_BLOCKED,
  isSnsImageUrl,
  resolveImagesForWorks,
} from "./imageFallback";

/** 全候補が失敗した作品で、外部 fetch を再試行するまでの間隔。 */
export const WORK_IMAGE_FAILURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * 検証済み Annict URL の記録（image_r2_key）をそのまま信じる期間。
 * 切れたら元 URL が生きているかを取り直して検証する。死んだ URL へ
 * リダイレクトし続けるとクライアントが読み込み失敗でプレースホルダーに
 * 落ちるため、長すぎない間隔で確かめ直す。
 */
const ANNICT_URL_REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000;

const IMAGE_FETCH_TIMEOUT_MS = 8000;
const IMAGE_FETCH_MAX_REDIRECTS = 3;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// 取り込み済み画像のキャッシュ期間。URL が作品単位で安定しているため
// immutable にはできない（取り込み元が差し替わる可能性がある）。
const HIT_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=604800";
// MAL 由来（image_source='mal'）の画像は、MAL API 規約 3(e) の削除依頼から
// 24 時間以内に消す必要がある（issue #241）。削除スクリプトは R2 と DB しか
// 消せず、前段の Cache API やクライアントのキャッシュは期限切れを待つしかない
// ため、max-age と stale-while-revalidate の合計を 12 時間に抑える。
const MAL_HIT_CACHE_CONTROL =
  "public, max-age=21600, stale-while-revalidate=21600";
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
  //   1. resolvedImageUrl（Kitsu / MAL のポスター）
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
 * クライアントはプレースホルダーに落ちる。
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
  options: { etag?: string | undefined; fromMal: boolean },
): Response {
  const headers = new Headers();
  headers.set("content-type", contentType);
  if (options.etag) headers.set("etag", options.etag);
  headers.set(
    "cache-control",
    options.fromMal ? MAL_HIT_CACHE_CONTROL : HIT_CACHE_CONTROL,
  );
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

/** 検証済みの外部画像 URL への誘導。edge・クライアント双方で短くキャッシュする。 */
function redirectToSource(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      "cache-control": "public, max-age=300",
    },
  });
}

/**
 * GET /images/works/:annictWorkId の本体。
 * R2 ヒット（Kitsu / MAL 由来。取り込み元が今の候補と一致）→ そのまま返す /
 * 検証済み Annict URL の記録 → 元 URL へリダイレクト /
 * ミス → 補完候補を fetch して R2 に保存、Annict 候補は検証のうえ誘導する。
 */
export async function serveWorkImage(
  db: DrizzleDb,
  bucket: R2Bucket,
  annictWorkId: number,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
    malClientId?: string | undefined;
  } = {},
): Promise<Response> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const repo = worksRepository(db);

  const row = await repo.getAnnictWorkById(annictWorkId);
  if (!row) return notFound();

  // 削除依頼で画像を消した作品（issue #241）は補完 URL を使わない。
  // 削除スクリプトが resolvedImageUrl を消しているが、外部からの書き戻しが
  // 残っていても拾わないようここでも外す。Annict の元の imageUrl は
  // MAL 由来ではないので候補に残す。
  const blocked = row.imageSource === IMAGE_SOURCE_BLOCKED;
  const candidates = workImageSourceCandidates({
    imageUrl: row.imageUrl,
    resolvedImageUrl: blocked ? null : row.resolvedImageUrl,
  });
  const resolvedCandidates = workImageSourceCandidates({
    imageUrl: null,
    resolvedImageUrl: blocked ? null : row.resolvedImageUrl,
  });
  const allAnnictCandidates = workImageSourceCandidates({
    imageUrl: row.imageUrl,
    resolvedImageUrl: null,
  });
  const annictCandidates = allAnnictCandidates.filter(
    (url) => !resolvedCandidates.includes(url),
  );
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
  // 旧オブジェクトに取得元の metadata は無い。URL ハッシュで補完元と
  // 確認できないものは Annict 由来の可能性があるため配信しない。
  const storedFromFallback =
    ownKey != null &&
    (stored?.customMetadata?.source === "kitsu" ||
      stored?.customMetadata?.source === "mal" ||
      (resolvedCandidates.some((url) =>
        ownKey.startsWith(`${workImageKeyPrefix(annictWorkId, url)}.`),
      ) &&
        !allAnnictCandidates.some((url) =>
          ownKey.startsWith(`${workImageKeyPrefix(annictWorkId, url)}.`),
        )));
  const storedResponse = () =>
    stored
      ? imageResponse(
          stored.body,
          stored.httpMetadata?.contentType ?? "application/octet-stream",
          // 取り込み元が Annict の URL でも、行が 'mal' なら短い方に倒す
          // （どちらから取り込んだかはキーのハッシュでしか分からないため）。
          { etag: stored.httpEtag, fromMal: row.imageSource === "mal" },
        )
      : notFound();
  // キーには取り込み元 URL のハッシュが入っている。今の候補のどれかと
  // 一致すれば最新。一致しなければ取り込み元が差し替わった（Annict の URL
  // 変更・MAL ID 変更による補完のやり直し等）ので取り込み直す。
  const keyMatchesCandidate =
    ownKey != null &&
    candidates.some((url) =>
      ownKey.startsWith(`${workImageKeyPrefix(annictWorkId, url)}.`),
    );
  // 'blocked' の行は補完画像を配信しない。キーの掃除は削除スクリプトに任せる。
  const storedServable = !blocked && storedFromFallback;
  if (stored && ownKey && storedServable) {
    // 候補が 1 つも無い（上流の画像が消えた）場合は、無いよりマシなので
    // 取り込み済みの画像を返し続ける。
    const isFresh = candidates.length === 0 || keyMatchesCandidate;
    // 取り込み直しはクールダウンに従う（取り込み成功時にも試行時刻が立つので、
    // 直近に取り込んだばかりの作品は叩き直さない）。
    if (isFresh || inCooldown) return storedResponse();
  }

  // --- 検証済み Annict URL の記録 ---
  // Annict 画像は R2 に置かず、検証できた元 URL のキーだけを image_r2_key に
  // 残す。キーのハッシュが今の Annict 候補と一致する行は「その URL へ誘導
  // してよい」記録なので、外部を叩き直さずリダイレクトする。同じキーに旧式の
  // Annict オブジェクトが残っている行も同じ判定で誘導する（そのオブジェクトは
  // 取得元が Annict と確定しているため配信・削除はせず、後片付けは
  // ルールブックの手順に任せる）。
  // 記録が古い（REVERIFY 超過）か、記録後に補完 URL が更新されている
  // （resolved_at > attempted_at）場合は優先度の高い補完から取り直す。
  const verifiedAnnictUrl =
    ownKey != null
      ? annictCandidates.find((url) =>
          ownKey.startsWith(`${workImageKeyPrefix(annictWorkId, url)}.`),
        )
      : undefined;
  const annictVerifyStale =
    row.imageR2AttemptedAt == null ||
    now.getTime() - row.imageR2AttemptedAt.getTime() >=
      ANNICT_URL_REVERIFY_AFTER_MS;
  const resolvedUpdatedAfterVerify =
    row.resolvedAt != null &&
    row.imageR2AttemptedAt != null &&
    row.resolvedAt.getTime() > row.imageR2AttemptedAt.getTime();
  if (
    verifiedAnnictUrl &&
    !annictVerifyStale &&
    !(resolvedUpdatedAfterVerify && resolvedCandidates.length > 0)
  ) {
    return redirectToSource(verifiedAnnictUrl);
  }

  // --- クールダウン（直近に全候補が失敗した作品は外部を叩かない） ---
  // キーだけ残ってオブジェクトが消えている行はクールダウンに関わらず
  // 取り込みを試す（失敗すれば末尾でキーを外して試行時刻を立てるので、
  // 次回以降はここで止まる）。Annict URL の検証記録もオブジェクトが無い
  // 点では同じで、古い記録はここを通って再検証される。
  // 逆にオブジェクトが残るが配信できない行（'blocked' の残りや
  // 取得元不明の旧画像）は、オブジェクトが取り除かれるまで状態が
  // 変わらないため、クールダウンで止める（止めないと失敗した
  // Annict URL へ表示のたびに外部 fetch が繰り返される）。
  if (
    inCooldown &&
    ((!stored && !ownKey) || (stored != null && !storedServable))
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

  let hit = await tryCandidates(resolvedCandidates);

  // --- 3. 全滅なら Kitsu で補完 URL を引き直す ---
  // Annict の URL が「見た目はまとも・実体は 404」の作品も先に補完を試す。
  // また Kitsu の新しい作品は 15 分で失効する署名付き URL を resolvedImageUrl
  // に持つため、解決済みでも URL が死んでいる作品がある。実際に取れなかった
  // ことが分かったここで MAL ID（無ければ Kitsu 作品 ID。issue #227 の
  // タイトル検索で採った行）から Kitsu を 1 回引き直し、得た新しい URL を
  // その場で取り込む（R2 に入れば以後は失効しても関係ない）。
  // 'none'（Kitsu にも無いことが確定済み）は TTL 内なら引き直さない。
  // TTL 切れならここでも 1 回引き直す。
  // 再解決結果は確定済みの 'none' を含めて書き戻し、resolvedAt を起点に
  // 次の再解決を TTL 分先送りする（cron と同じ扱い）。
  // 'blocked'（削除依頼で画像を消した作品。issue #241）は引き直さない。
  // Kitsu へのリクエスト自体の失敗は結果が返らないので書き込まない
  // （'none' に確定させず、クールダウン切れ後にまた試行される）。
  const noneResolutionStale =
    row.imageSource === "none" &&
    (row.resolvedAt == null ||
      now.getTime() - row.resolvedAt.getTime() >=
        IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS ||
      (row.malSearchAttemptedAt != null &&
        row.malSearchAttemptedAt.getTime() > row.resolvedAt.getTime()));
  let resolvedSource = row.imageSource;
  if (
    !hit &&
    !blocked &&
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
      { malClientId: options.malClientId },
    );
    if (resolved) {
      await repo.updateResolvedImage(annictWorkId, {
        resolvedImageUrl: resolved.resolvedImageUrl,
        imageSource: resolved.imageSource,
        resolvedAt: now,
      });
      resolvedSource = resolved.imageSource;
      if (resolved.resolvedImageUrl) {
        hit = await tryCandidates(
          workImageSourceCandidates({
            imageUrl: null,
            resolvedImageUrl: resolved.resolvedImageUrl,
          }),
        );
      }
    }
  }

  if (!hit && stored && storedServable) {
    await repo.markImageR2Attempted(annictWorkId, now);
    return storedResponse();
  }
  // 補完が取れなければ検証済みの Annict URL へ誘導する。今回の補完試行を
  // 記録しておかないと、記録後に補完 URL が更新された行は表示のたびに
  // 補完を取り直してしまう。
  if (!hit && verifiedAnnictUrl && !annictVerifyStale) {
    await repo.markImageR2Attempted(annictWorkId, now);
    return redirectToSource(verifiedAnnictUrl);
  }
  if (!hit) hit = await tryCandidates(annictCandidates);

  if (hit && annictCandidates.includes(hit.url)) {
    // 元 URL が画像として取得できたので、検証済みとしてキーだけを記録して
    // 誘導する（Annict 画像は R2 に保存しない）。記録に失敗しても
    // （取り込み中に行が 'blocked' 等へ変わった場合）リダイレクトは返す。
    await repo.linkImageR2Key(
      annictWorkId,
      workImageKey(annictWorkId, hit.url, hit.image.ext),
      now,
      resolvedSource ?? null,
    );
    return redirectToSource(hit.url);
  }

  if (!hit) {
    if (stored && !storedServable) {
      // 取得元が確認できない旧画像は配信も削除もしない。
      // キーが検証済み Annict URL の記録だった場合、再検証に失敗した
      // ことになるので記録は外す（残したまま試行時刻だけ立てると、
      // 失敗した時刻が検証期限を延ばして死んだ URL へ誘導し続ける）。
      // 残ったオブジェクトの後片付けはルールブックの手順で行う。
      if (verifiedAnnictUrl != null) {
        await repo.updateImageR2Key(annictWorkId, null, now);
      } else {
        await repo.markImageR2Attempted(annictWorkId, now);
      }
      return notFound();
    }
    if (stored && storedServable) {
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
    customMetadata:
      resolvedSource === "mal" || resolvedSource === "kitsu"
        ? { source: resolvedSource }
        : {},
  });
  // 取り込み中に削除スクリプトが行を 'blocked' にしていたら（issue #241）、
  // キーを書き戻さず、置いたオブジェクトも消して配信しない。
  const linked = await repo.linkImageR2Key(
    annictWorkId,
    key,
    now,
    resolvedSource ?? null,
  );
  if (!linked) {
    await bucket.delete(key).catch(() => {});
    return notFound();
  }
  // 取り込み元が変わって残った旧オブジェクトは消す（参照されないゴミを増やさない）。
  // 消すのはこの作品自身のキーだけ（別作品のオブジェクトには触れない）。
  if (ownKey && ownKey !== key && storedServable) {
    await bucket.delete(ownKey).catch(() => {});
  }
  return imageResponse(hit.image.data, hit.image.contentType, {
    fromMal: resolvedSource === "mal",
  });
}
