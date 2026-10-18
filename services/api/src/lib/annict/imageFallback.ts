// Annict の画像フィールド（image.internalUrl / recommendedImageUrl / SNS 系）が
// 空 or SNS placeholder に落ちる作品を、malAnimeId 経由で Kitsu → Jikan の順で補完する。
// 詳細は issue #86。
//
// 設計方針:
//   * Kitsu を第一候補にする（MAL ID の対応表 mappings を 20 件まとめて引け、
//     ポスター画像の CDN も Cloudflare Workers から取得できる）。
//     以前は AniList を使っていたが、AniList は Cloudflare Workers からの
//     リクエストを API・画像 CDN とも 403（"You have been manually blocked"）で
//     拒否しており、本番では一度も解決できていなかった。
//   * Kitsu で取れなかったものだけを Jikan で個別リトライ（3 req/sec 制限のため）。
//     Jikan も Workers からは 522 になることが多いので、取れたら儲けもの扱い。
//   * どちらも失敗 or 画像が無ければ 'none' をネガキャッシュ（次回同じ MAL ID を
//     再問い合わせしない）。
//   * ネットワーク失敗（fetch reject / 5xx）は throw せず「未解決」として静かに落とす。
//     lazy resolve は best-effort であり、失敗しても呼び出し元（read-through / 検索）を
//     壊してはいけない。次回アクセス時にまた挑戦できる。

const KITSU_MAPPINGS_ENDPOINT = "https://kitsu.io/api/edge/mappings";
const JIKAN_ENDPOINT_BASE = "https://api.jikan.moe/v4/anime";

// Annict の SNS 系画像 URL は「表示できるが実質プレースホルダー」なため、
// これらしか無い作品もフォールバック対象に含めたい。Twitter/Facebook の
// アバター画像は URL パターンから判別できる。厳密なマッチ（== null）だと
// SNS placeholder が残ってしまうため、URL のホスト部分でも判定する。
// また Web 版は HTTPS 配信のため、http: の作品画像も Mixed Content 回避の
// フォールバック対象にする。
const PLACEHOLDER_HOST_PATTERNS = [
  /pbs\.twimg\.com/i,
  /twimg\.com/i,
  /graph\.facebook\.com/i,
  /fbcdn\.net/i,
];

function isInsecureHttpUrl(url: string): boolean {
  return /^http:/i.test(url.trim());
}

/**
 * Annict の image URL が「実質プレースホルダー or HTTPS 画面で使えない」かを判定する。
 * null / 空文字 / SNS のアバター URL / http: URL のいずれかならフォールバック対象。
 */
export function isPlaceholderImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (isInsecureHttpUrl(trimmed)) return true;
  return isSnsImageUrl(trimmed);
}

/**
 * SNS アバター・バナー系など「作品の表紙画像でないことがホストから分かる」URL か。
 * null/空や http: の判定は含まない（そこまで必要なら isPlaceholderImageUrl）。
 * 画像プロキシ側（workImage）では「http: の実画像は https に上げて取り込みを試すが
 * SNS アバターは対象外」と判定したいため、ホストパターン判定だけ分離して export する。
 */
export function isSnsImageUrl(url: string): boolean {
  return PLACEHOLDER_HOST_PATTERNS.some((re) => re.test(url));
}

/** 画像フォールバックの供給元。annict_works.image_source に保存する値。 */
// 'anilist' は AniList を使っていた頃の値（既存行の互換のため残す）。
export type ImageSource = "kitsu" | "anilist" | "jikan" | "none";

/** 解決対象の 1 件。annictWorkId は D1 更新のキーに使うため必須。 */
export type ImageFallbackInput = {
  annictWorkId: number;
  malAnimeId: number;
};

/** 1 作品分の解決結果。resolvedImageUrl が null なら 'none'（ネガキャッシュ）。 */
export type ImageFallbackResult = {
  annictWorkId: number;
  malAnimeId: number;
  resolvedImageUrl: string | null;
  imageSource: ImageSource;
};

// Kitsu の mappings で、1 リクエストに詰め込む最大件数。
// JSON:API の page[limit] の上限が 20 なので、それに合わせる。
const KITSU_BATCH_SIZE = 20;

// Kitsu / Jikan への 1 リクエストのタイムアウト。read-through 全体を止めないよう
// 短めに設定する（waitUntil の裏で回るとはいえ、Workers の CPU budget に響く）。
const REMOTE_FETCH_TIMEOUT_MS = 6000;

// Jikan のレート制限（公称 3 req/sec / 60 req/min）を踏まえた最小間隔。
// 350ms 空ければ理論上 2.8 req/sec で 3 req/sec に触れない。
const JIKAN_MIN_INTERVAL_MS = 350;

// HTTP-triggered Workers の waitUntil はレスポンス後 30 秒で未完了タスクが
// キャンセルされる。Kitsu 1 バッチ + Jikan の最悪タイムアウトを踏んでも
// 30 秒内に収まりやすいよう、1 リクエストで裏解決する件数を小さく保つ。
export const IMAGE_FALLBACK_MAX_TARGETS_PER_INVOCATION = 3;

export function limitImageFallbackTargets<T>(targets: T[]): T[] {
  return targets.slice(0, IMAGE_FALLBACK_MAX_TARGETS_PER_INVOCATION);
}

/**
 * MAL ID 群に対して Kitsu → Jikan の順でフォールバック解決する。
 * 入力の順序は保持しない。取れなかったものは imageSource='none' として返す。
 *
 * @param inputs   解決対象の (annictWorkId, malAnimeId) の配列。
 * @param fetchImpl 差し替え可能な fetch（テスト用）。
 */
export async function resolveImagesForWorks(
  inputs: ImageFallbackInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<ImageFallbackResult[]> {
  if (inputs.length === 0) return [];

  const uniqueMalIds = uniqueMalAnimeIds(inputs);

  // 供給元別に「解決できた MAL ID → URL」の Map を持つ。両方失敗した MAL ID は
  // どの Map にも入らず、最終的に 'none'（ネガキャッシュ）扱いになる。
  const kitsuHits = await fetchKitsuHits(uniqueMalIds, fetchImpl);
  const jikanHits = new Map<number, string>();

  // --- Jikan フォールバック（Kitsu で取れなかった MAL ID のみ） ---
  // 429（Too Many Requests）を返した MAL ID は「未解決・再試行可」なので
  // ネガキャッシュしないよう記録して、最終出力から除外する。
  const jikanRetry = new Set<number>();
  const remainingMalIds = uniqueMalIds.filter((id) => !kitsuHits.has(id));
  let firstJikan = true;
  for (const malId of remainingMalIds) {
    // Jikan 公称 3 req/sec を踏まえて 2 件目以降に最小間隔を挟む。
    if (!firstJikan) await sleep(JIKAN_MIN_INTERVAL_MS);
    firstJikan = false;
    const result = await fetchJikanImage(malId, fetchImpl);
    if (result === "retry") {
      jikanRetry.add(malId);
    } else if (result) {
      jikanHits.set(malId, result);
    }
  }

  // --- 入力ごとの結果に展開 ---
  // Jikan が 429 だった MAL ID は「未解決・再試行可」扱いで結果を返さない
  // （ネガキャッシュされないように呼び出し側に見せない）。
  const out: ImageFallbackResult[] = [];
  for (const input of inputs) {
    const kitsu = kitsuHits.get(input.malAnimeId);
    if (kitsu) {
      out.push({
        annictWorkId: input.annictWorkId,
        malAnimeId: input.malAnimeId,
        resolvedImageUrl: kitsu,
        imageSource: "kitsu",
      });
      continue;
    }
    const jikan = jikanHits.get(input.malAnimeId);
    if (jikan) {
      out.push({
        annictWorkId: input.annictWorkId,
        malAnimeId: input.malAnimeId,
        resolvedImageUrl: jikan,
        imageSource: "jikan",
      });
      continue;
    }
    if (jikanRetry.has(input.malAnimeId)) {
      // 429 リトライ対象は保存しない（次回アクセスで再挑戦させる）。
      continue;
    }
    out.push({
      annictWorkId: input.annictWorkId,
      malAnimeId: input.malAnimeId,
      resolvedImageUrl: null,
      imageSource: "none",
    });
  }
  return out;
}

/**
 * Kitsu のバッチ解決だけを行う軽量版（Jikan フォールバックは実行しない）。
 *
 * /works/search のレスポンス経路で同期的に呼ぶためのもの。非同期解決だけでは
 * 全件の解決に時間がかかり、初回表示では大半の作品がフォールバック表示に
 * なっていた（issue #108）。Kitsu は 20 件/リクエストの mappings で
 * まとめて取れるため、レスポンスを待たせる経路でも許容できるコストで同期
 * 解決できる。直列呼び出しになる Jikan 側は遅いのでここでは叩かず、miss 分は
 * cron の pending 解決に委ねる（issue #127: Queue 廃止）。
 *
 * 返り値は「解決できたものだけ」。Kitsu miss は結果に含まれない
 * （'none' のネガキャッシュはしない — Jikan で取れる可能性が残るため）。
 */
export async function resolveImagesViaKitsu(
  inputs: ImageFallbackInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<ImageFallbackResult[]> {
  if (inputs.length === 0) return [];

  const hits = await fetchKitsuHits(uniqueMalAnimeIds(inputs), fetchImpl);
  return inputs.flatMap((input) => {
    const resolvedImageUrl = hits.get(input.malAnimeId);
    return resolvedImageUrl
      ? [
          {
            annictWorkId: input.annictWorkId,
            malAnimeId: input.malAnimeId,
            resolvedImageUrl,
            imageSource: "kitsu" as const,
          },
        ]
      : [];
  });
}

/** 入力から Kitsu 問い合わせ用に dedupe した MAL ID 一覧を作る。 */
function uniqueMalAnimeIds(inputs: ImageFallbackInput[]): number[] {
  return Array.from(new Set(inputs.map((i) => i.malAnimeId))).filter(
    (id) => Number.isSafeInteger(id) && id > 0,
  );
}

/**
 * MAL ID 群を Kitsu の mappings でまとめて解決し、
 * 「解決できた MAL ID → URL」の Map を返す。失敗・miss は Map に入らない。
 * チャンクは並列に投げる（検索レスポンス経路では直列だとレイテンシに直結するため）。
 */
async function fetchKitsuHits(
  malIds: number[],
  fetchImpl: typeof fetch,
): Promise<Map<number, string>> {
  const chunks: number[][] = [];
  for (let i = 0; i < malIds.length; i += KITSU_BATCH_SIZE) {
    chunks.push(malIds.slice(i, i + KITSU_BATCH_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) => fetchKitsuBatch(chunk, fetchImpl)),
  );

  const hits = new Map<number, string>();
  for (const chunkResult of results) {
    for (const [malId, url] of chunkResult) {
      hits.set(malId, url);
    }
  }
  return hits;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kitsu の mappings（MAL ID → Kitsu 作品の対応表）で複数 MAL ID をまとめて解決する。
 * 返り値は `[malAnimeId, posterImageUrl]` の配列（取れたものだけ）。
 * ネットワーク失敗・非 200 応答は空配列で静かに返す。
 * 見つからない MAL ID は結果から落ちるだけで、他の ID の解決は失われない。
 */
async function fetchKitsuBatch(
  malIds: number[],
  fetchImpl: typeof fetch,
): Promise<[number, string][]> {
  if (malIds.length === 0) return [];

  const url = new URL(KITSU_MAPPINGS_ENDPOINT);
  url.searchParams.set("filter[externalSite]", "myanimelist/anime");
  url.searchParams.set("filter[externalId]", malIds.join(","));
  url.searchParams.set("include", "item");
  url.searchParams.set("fields[anime]", "posterImage");
  url.searchParams.set("page[limit]", String(KITSU_BATCH_SIZE));

  const res = await safeFetch(
    fetchImpl,
    url.toString(),
    { headers: { Accept: "application/vnd.api+json" } },
    REMOTE_FETCH_TIMEOUT_MS,
  );
  if (!res || !res.ok) return [];

  let json: {
    data?: ({
      attributes?: { externalId?: string | null } | null;
      relationships?: {
        item?: { data?: { id?: string; type?: string } | null } | null;
      } | null;
    } | null)[];
    included?: ({
      id?: string;
      type?: string;
      attributes?: {
        posterImage?: {
          large?: string | null;
          original?: string | null;
          medium?: string | null;
        } | null;
      } | null;
    } | null)[];
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return [];
  }

  const posterByAnimeId = new Map<string, string>();
  for (const item of json.included ?? []) {
    if (item?.type !== "anime" || !item.id) continue;
    const img = item.attributes?.posterImage;
    const poster = img?.large ?? img?.original ?? img?.medium ?? null;
    if (poster) posterByAnimeId.set(item.id, poster);
  }

  // 問い合わせていない ID が返ってきても採用しない（フィルタの取り違え防止）。
  // 1 つの MAL ID に複数の Kitsu 作品が対応していたら、先に見つかった方を使う。
  const requested = new Set(malIds);
  const out = new Map<number, string>();
  for (const mapping of json.data ?? []) {
    const malId = Number(mapping?.attributes?.externalId);
    if (!requested.has(malId) || out.has(malId)) continue;
    const item = mapping?.relationships?.item?.data;
    if (item?.type !== "anime" || !item.id) continue;
    const poster = posterByAnimeId.get(item.id);
    if (poster) out.set(malId, poster);
  }
  return [...out];
}

/**
 * Jikan で 1 件解決する。
 *   - 解決成功: URL 文字列
 *   - 429（rate limit）または 5xx: `"retry"`（呼び出し側でネガキャッシュしない）
 *   - それ以外の失敗（404 / ネットワーク失敗 / JSON 解析失敗）: null
 * MAL の CDN URL（cdn.myanimelist.net）を返す点に注意（ホットリンク運用は要検討）。
 */
async function fetchJikanImage(
  malId: number,
  fetchImpl: typeof fetch,
): Promise<string | "retry" | null> {
  const res = await safeFetch(
    fetchImpl,
    `${JIKAN_ENDPOINT_BASE}/${malId}`,
    { headers: { Accept: "application/json" } },
    REMOTE_FETCH_TIMEOUT_MS,
  );
  // ネットワーク失敗（safeFetch が null を返した）も一時障害の可能性が高い。
  // ここで null にすると 'none' が永続化されるため retry 扱いにする。
  if (!res) return "retry";
  if (res.status === 429 || res.status >= 500) return "retry";
  if (!res.ok) return null;

  let json: {
    data?: {
      images?: {
        jpg?: { large_image_url?: string | null; image_url?: string | null };
        webp?: { large_image_url?: string | null; image_url?: string | null };
      };
    };
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return null;
  }
  const images = json.data?.images;
  return (
    images?.webp?.large_image_url ??
    images?.jpg?.large_image_url ??
    images?.webp?.image_url ??
    images?.jpg?.image_url ??
    null
  );
}

/** タイムアウト・ネットワーク失敗を吸収する fetch ラッパ。失敗時は null を返す。 */
async function safeFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
