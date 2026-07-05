// Annict の画像フィールド（image.internalUrl / recommendedImageUrl / SNS 系）が
// 空 or SNS placeholder に落ちる作品を、malAnimeId 経由で AniList → Jikan の順で補完する。
// 詳細は issue #86。
//
// 設計方針:
//   * AniList を第一候補にする（安定・レート制限に余裕・alias バッチが効く）。
//   * AniList で取れなかったものだけを Jikan で個別リトライ（3 req/sec 制限のため）。
//   * どちらも失敗 or 画像が無ければ 'none' をネガキャッシュ（次回同じ MAL ID を
//     再問い合わせしない）。
//   * ネットワーク失敗（fetch reject / 5xx）は throw せず「未解決」として静かに落とす。
//     lazy resolve は best-effort であり、失敗しても呼び出し元（read-through / 検索）を
//     壊してはいけない。次回アクセス時にまた挑戦できる。

const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const JIKAN_ENDPOINT_BASE = "https://api.jikan.moe/v4/anime";

// Annict の SNS 系画像 URL は「表示できるが実質プレースホルダー」なため、
// これらしか無い作品もフォールバック対象に含めたい。Twitter/Facebook の
// アバター画像は URL パターンから判別できる。厳密なマッチ（== null）だと
// SNS placeholder が残ってしまうため、URL のホスト部分でも判定する。
const PLACEHOLDER_HOST_PATTERNS = [
  /pbs\.twimg\.com/i,
  /twimg\.com/i,
  /graph\.facebook\.com/i,
  /fbcdn\.net/i,
];

/**
 * Annict の image URL が「実質プレースホルダー」かどうかを判定する。
 * null / 空文字 / SNS のアバター URL のいずれかならフォールバック対象。
 */
export function isPlaceholderImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_HOST_PATTERNS.some((re) => re.test(trimmed));
}

/** 画像フォールバックの供給元。annict_works.image_source に保存する値。 */
export type ImageSource = "anilist" | "jikan" | "none";

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

// AniList のクエリで、1 リクエストに詰め込む最大件数。
// Cloudflare Workers のサブリクエスト上限 (50/req) と、AniList 側の
// 「1 クエリで多数の Media を alias で取る」パターンで実運用上の
// 詰まりにくさを両立するため 20 件に設定。
const ANILIST_BATCH_SIZE = 20;

// AniList / Jikan への 1 リクエストのタイムアウト。read-through 全体を止めないよう
// 短めに設定する（waitUntil の裏で回るとはいえ、Workers の CPU budget に響く）。
const REMOTE_FETCH_TIMEOUT_MS = 6000;

// Jikan のレート制限（公称 3 req/sec / 60 req/min）を踏まえた最小間隔。
// 350ms 空ければ理論上 2.8 req/sec で 3 req/sec に触れない。
const JIKAN_MIN_INTERVAL_MS = 350;

/**
 * MAL ID 群に対して AniList → Jikan の順でフォールバック解決する。
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

  // AniList 呼び出しを最小化するため malAnimeId ごとに dedupe した集合で解く。
  const uniqueMalIds = Array.from(
    new Set(inputs.map((i) => i.malAnimeId)),
  ).filter((id) => Number.isSafeInteger(id) && id > 0);

  // 供給元別に「解決できた MAL ID → URL」の Map を持つ。両方失敗した MAL ID は
  // どの Map にも入らず、最終的に 'none'（ネガキャッシュ）扱いになる。
  const anilistHits = new Map<number, string>();
  const jikanHits = new Map<number, string>();

  // --- AniList バッチ ---
  for (let i = 0; i < uniqueMalIds.length; i += ANILIST_BATCH_SIZE) {
    const chunk = uniqueMalIds.slice(i, i + ANILIST_BATCH_SIZE);
    const chunkResult = await fetchAnilistBatch(chunk, fetchImpl);
    for (const [malId, url] of chunkResult) {
      anilistHits.set(malId, url);
    }
  }

  // --- Jikan フォールバック（AniList で取れなかった MAL ID のみ） ---
  // 429（Too Many Requests）を返した MAL ID は「未解決・再試行可」なので
  // ネガキャッシュしないよう記録して、最終出力から除外する。
  const jikanRetry = new Set<number>();
  const remainingMalIds = uniqueMalIds.filter((id) => !anilistHits.has(id));
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
    const anilist = anilistHits.get(input.malAnimeId);
    if (anilist) {
      out.push({
        annictWorkId: input.annictWorkId,
        malAnimeId: input.malAnimeId,
        resolvedImageUrl: anilist,
        imageSource: "anilist",
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AniList の alias バッチで複数 MAL ID をまとめて解決する。
 * 返り値は `[malAnimeId, coverImageUrl]` の配列（取れたものだけ）。
 * ネットワーク失敗・非 200 応答は空配列で静かに返す。
 */
async function fetchAnilistBatch(
  malIds: number[],
  fetchImpl: typeof fetch,
): Promise<[number, string][]> {
  if (malIds.length === 0) return [];

  // alias 名は英数字 + アンダースコアのみ許可されるため `m<id>` で構築する。
  const selection = malIds
    .map(
      (id) => `m${id}: Media(idMal: ${id}, type: ANIME) {
  coverImage { extraLarge large medium }
}`,
    )
    .join("\n");
  const query = `query { ${selection} }`;

  const res = await safeFetch(
    fetchImpl,
    ANILIST_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query }),
    },
    REMOTE_FETCH_TIMEOUT_MS,
  );
  if (!res || !res.ok) return [];

  let json: {
    data?: Record<
      string,
      {
        coverImage?: {
          extraLarge?: string | null;
          large?: string | null;
          medium?: string | null;
        } | null;
      } | null
    >;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return [];
  }
  const data = json.data ?? {};

  const out: [number, string][] = [];
  for (const id of malIds) {
    const node = data[`m${id}`];
    const img = node?.coverImage;
    const url = img?.extraLarge ?? img?.large ?? img?.medium ?? null;
    if (url) out.push([id, url]);
  }
  return out;
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
