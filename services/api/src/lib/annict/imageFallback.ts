// Annict の画像フィールド（image.internalUrl / recommendedImageUrl / SNS 系）が
// 空 or SNS placeholder に落ちる作品を、malAnimeId 経由で Kitsu で補完する。
// 詳細は issue #86。malAnimeId を持たない作品はタイトル検索で採った
// kitsu_anime_id から Kitsu の作品リソースを直接引く（issue #227）。
//
// 設計方針:
//   * 補完先は Kitsu のみ（MAL ID の対応表 mappings を 20 件まとめて引け、
//     ポスター画像の CDN も Cloudflare Workers から取得できる）。
//     以前は AniList を使っていたが、AniList は Cloudflare Workers からの
//     リクエストを API・画像 CDN とも 403（"You have been manually blocked"）で
//     拒否しており、本番では一度も解決できていなかった。Jikan も
//     Cloudflare Workers からは 522 になることが多く、5xx はネガキャッシュ
//     されないため「届かないのに毎時間叩き直される」状態になっていたので
//     補完経路から外した。
//   * Kitsu に MAL ID の対応が無い作品は MAL 公式 API（v2）で MAL ID から
//     直接ポスターを引く（issue #238）。Kitsu は新作や一部作品で MAL の
//     mappings を欠くため。MAL API は 1 件ずつしか引けないので、1 回の解決で
//     問い合わせる件数を MAL_MAX_LOOKUPS_PER_CALL に絞る（上限超過分は
//     「不明」扱いで次回に回す）。Client ID（MAL_CLIENT_ID）が無い環境では
//     MAL を使わず Kitsu だけで解決する。
//     MAL API の規約上、取得した画像は加工してはならず、削除依頼から 24 時間
//     以内に消せる必要がある（image_source='mal' で見分けられる）。
//   * Kitsu・MAL のどちらにも画像が無ければ 'none' をネガキャッシュ。
//     'none' のままだと二度と拾えないため、resolved_at 起点の TTL
//     （IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS）で再解決される。
//     cron（imageFallbackPending）と画像プロキシ（workImage）の両方が使う。
//   * Kitsu へのリクエスト自体の失敗（fetch reject / 5xx / 応答の解析失敗）は
//     「解決可否が不明」として結果を返さない（'none' にしない）。呼び出し側の
//     クールダウン切れ後に再試行される。
//   * lazy resolve は best-effort であり、失敗しても呼び出し元
//     （read-through / 検索）を壊してはいけない。

const KITSU_MAPPINGS_ENDPOINT = "https://kitsu.io/api/edge/mappings";
const KITSU_ANIME_ENDPOINT = "https://kitsu.io/api/edge/anime";
const MAL_ANIME_ENDPOINT = "https://api.myanimelist.net/v2/anime";

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

/**
 * 'none'（Kitsu にも画像が無いと確定済み）の作品を再解決するまでの間隔。
 * resolved_at を起点にする（確定のたびに updateResolvedImage が更新するので、
 * 再解決しても 'none' のままなら TTL がそのたび延長される）。
 * 'none' のままにすると将来 Kitsu 側に対応・画像が登録されても二度と拾え
 * ないため、長めの間隔で拾い直す。
 */
export const IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** 画像フォールバックの供給元。annict_works.image_source に保存する値。 */
// 'anilist'・'jikan' は過去の供給元で既存行に残っている値（互換のため
// カラムはフリーテキストのまま）。現在書き込むのは 'kitsu' | 'mal' | 'none' だけ。
export type ImageSource = "kitsu" | "mal" | "none";

/** 解決対象の 1 件。annictWorkId は D1 更新のキーに使うため必須。 */
export type ImageFallbackInput = {
  annictWorkId: number;
  // あればこちら優先（mappings のバッチ解決）。無い作品は kitsuAnimeId で
  // 作品リソースを直接引く（タイトル検索で採った行。issue #227）。
  malAnimeId: number | null;
  kitsuAnimeId?: number | null;
};

/** 1 作品分の解決結果。resolvedImageUrl が null なら 'none'（ネガキャッシュ）。 */
export type ImageFallbackResult = {
  annictWorkId: number;
  malAnimeId: number | null;
  resolvedImageUrl: string | null;
  imageSource: ImageSource;
};

// Kitsu の mappings で、1 リクエストに詰め込む最大件数。
// JSON:API の page[limit] の上限が 20 なので、それに合わせる。
const KITSU_BATCH_SIZE = 20;
// 1 バッチで追う mappings のページ数の上限。重複行は稀なので通常は 1 ページで
// 済み、追加ページが要るのは重複が多いときだけ。
const KITSU_MAX_PAGES = 3;

// MAL API に 1 回の解決で問い合わせる最大件数。MAL API は作品 1 件ずつの
// エンドポイントしかなく、cron 1 回のサブリクエスト予算（Free プラン 50）と
// MAL サーバーへの負荷（規約 6 条）の両方を考えて小さく保つ。
export const MAL_MAX_LOOKUPS_PER_CALL = 10;

// Kitsu への 1 リクエストのタイムアウト。read-through 全体を止めないよう
// 短めに設定する（waitUntil の裏で回るとはいえ、Workers の CPU budget に響く）。
const REMOTE_FETCH_TIMEOUT_MS = 6000;

// HTTP-triggered Workers の waitUntil はレスポンス後 30 秒で未完了タスクが
// キャンセルされる。Kitsu 1 バッチの最悪タイムアウトを踏んでも
// 30 秒内に収まりやすいよう、1 リクエストで裏解決する件数を小さく保つ。
export const IMAGE_FALLBACK_MAX_TARGETS_PER_INVOCATION = 3;

export function limitImageFallbackTargets<T>(targets: T[]): T[] {
  return targets.slice(0, IMAGE_FALLBACK_MAX_TARGETS_PER_INVOCATION);
}

/**
 * MAL ID 群を Kitsu（Kitsu に無ければ MAL API）でフォールバック解決する。
 * 入力の順序は保持しない。どちらにも無いものは imageSource='none' として返す。
 * 問い合わせ自体が失敗した ID・MAL の問い合わせ件数上限で後回しにした ID は
 * 結果に含めない（ネガキャッシュしない。呼び出し側のクールダウン切れ後に
 * 再試行される）。
 *
 * @param inputs   解決対象の (annictWorkId, malAnimeId) の配列。
 * @param fetchImpl 差し替え可能な fetch（テスト用）。
 * @param options.malClientId MAL API の Client ID。無ければ MAL は使わない。
 */
export async function resolveImagesForWorks(
  inputs: ImageFallbackInput[],
  fetchImpl: typeof fetch = fetch,
  options: { malClientId?: string | undefined } = {},
): Promise<ImageFallbackResult[]> {
  if (inputs.length === 0) return [];

  const [kitsu, posters] = await Promise.all([
    fetchKitsuHits(uniqueMalAnimeIds(inputs), fetchImpl),
    fetchKitsuPosterHits(uniqueKitsuAnimeIds(inputs), fetchImpl),
  ]);

  // Kitsu で「無い」と確定した MAL ID だけを MAL API で引き直す。
  // Kitsu 側の失敗で不明な ID は Kitsu の再試行に任せる。
  const kitsuMisses = uniqueMalAnimeIds(inputs).filter(
    (id) => !kitsu.hits.has(id) && !kitsu.unresolved.has(id),
  );
  const mal = options.malClientId
    ? await fetchMalPictureHits(kitsuMisses, options.malClientId, fetchImpl)
    : { hits: new Map<number, string>(), unresolved: new Set<number>() };

  return inputs.flatMap((input): ImageFallbackResult[] => {
    // MAL ID がある作品は mappings のバッチ解決、無い作品は Kitsu の
    // 作品 ID から直接引く。いずれも「Kitsu に無い」→ 'none'、
    // リクエスト自体の失敗 → 結果なし（解決可否は不明）。
    const malPicture =
      input.malAnimeId != null ? mal.hits.get(input.malAnimeId) : undefined;
    if (malPicture) {
      return [
        {
          annictWorkId: input.annictWorkId,
          malAnimeId: input.malAnimeId,
          resolvedImageUrl: malPicture,
          imageSource: "mal" as const,
        },
      ];
    }
    const [resolvedImageUrl, failed] =
      input.malAnimeId != null
        ? ([
            kitsu.hits.get(input.malAnimeId),
            kitsu.unresolved.has(input.malAnimeId) ||
              mal.unresolved.has(input.malAnimeId),
          ] as const)
        : input.kitsuAnimeId != null
          ? ([
              posters.hits.get(input.kitsuAnimeId),
              posters.unresolved.has(input.kitsuAnimeId),
            ] as const)
          : ([undefined, false] as const);
    if (resolvedImageUrl) {
      return [
        {
          annictWorkId: input.annictWorkId,
          malAnimeId: input.malAnimeId,
          resolvedImageUrl,
          imageSource: "kitsu" as const,
        },
      ];
    }
    // バッチ自体の失敗で解決可否が不明な ID は結果を返さない
    // （'none' のネガキャッシュで確定させない）。
    if (failed) return [];
    return [
      {
        annictWorkId: input.annictWorkId,
        malAnimeId: input.malAnimeId,
        resolvedImageUrl: null,
        imageSource: "none" as const,
      },
    ];
  });
}

/**
 * Kitsu のバッチ解決だけを行う軽量版。
 *
 * /works/search のレスポンス経路で同期的に呼ぶためのもの。非同期解決だけでは
 * 全件の解決に時間がかかり、初回表示では大半の作品がフォールバック表示に
 * なっていた（issue #108）。Kitsu は 20 件/リクエストの mappings で
 * まとめて取れるため、レスポンスを待たせる経路でも許容できるコストで同期
 * 解決できる。miss 分は cron の pending 解決に委ねる（issue #127: Queue 廃止）。
 *
 * 返り値は「解決できたものだけ」。Kitsu miss は結果に含まれない
 * （'none' のネガキャッシュはしない — 検索経路では同期解決が
 * ベストエフォートのため、確定は cron 側の resolveImagesForWorks に任せる）。
 */
export async function resolveImagesViaKitsu(
  inputs: ImageFallbackInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<ImageFallbackResult[]> {
  if (inputs.length === 0) return [];

  const [{ hits }, posters] = await Promise.all([
    fetchKitsuHits(uniqueMalAnimeIds(inputs), fetchImpl),
    fetchKitsuPosterHits(uniqueKitsuAnimeIds(inputs), fetchImpl),
  ]);
  return inputs.flatMap((input) => {
    const resolvedImageUrl =
      input.malAnimeId != null
        ? hits.get(input.malAnimeId)
        : input.kitsuAnimeId != null
          ? posters.hits.get(input.kitsuAnimeId)
          : undefined;
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
    (id): id is number => id != null && Number.isSafeInteger(id) && id > 0,
  );
}

/**
 * 入力から dedupe した Kitsu 作品 ID 一覧を作る。
 * MAL ID がある作品は mappings 側で解決するので除外する。
 */
function uniqueKitsuAnimeIds(inputs: ImageFallbackInput[]): number[] {
  return Array.from(
    new Set(
      inputs.filter((i) => i.malAnimeId == null).map((i) => i.kitsuAnimeId),
    ),
  ).filter(
    (id): id is number => id != null && Number.isSafeInteger(id) && id > 0,
  );
}

/**
 * MAL ID 群を Kitsu の mappings でまとめて解決する。
 * チャンクは並列に投げる（検索レスポンス経路では直列だとレイテンシに直結するため）。
 *
 * 返り値:
 *   hits       「解決できた MAL ID → URL」の Map。失敗・miss は入らない。
 *   unresolved バッチ自体が失敗して解決可否が不明の MAL ID。
 *              呼び出し側はこれらを 'none' に確定させてはいけない。
 */
async function fetchKitsuHits(
  malIds: number[],
  fetchImpl: typeof fetch,
): Promise<{ hits: Map<number, string>; unresolved: Set<number> }> {
  const chunks: number[][] = [];
  for (let i = 0; i < malIds.length; i += KITSU_BATCH_SIZE) {
    chunks.push(malIds.slice(i, i + KITSU_BATCH_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) => fetchKitsuBatch(chunk, fetchImpl)),
  );

  const hits = new Map<number, string>();
  const unresolved = new Set<number>();
  for (const [index, chunkResult] of results.entries()) {
    for (const [malId, url] of chunkResult.hits) {
      hits.set(malId, url);
    }
    // バッチ自体が失敗したチャンクの未解決 ID は「miss」ではなく
    // 「不明」として記録する（次ページ打ち切りで残った ID も同じ扱い）。
    if (!chunkResult.complete) {
      for (const malId of chunks[index] ?? []) {
        if (!hits.has(malId)) unresolved.add(malId);
      }
    }
  }
  return { hits, unresolved };
}

/**
 * MAL API（v2）で MAL ID ごとに main_picture を引く。
 * 先頭 MAL_MAX_LOOKUPS_PER_CALL 件だけを問い合わせ、残りは unresolved
 * （解決可否は不明）として返して次回に回す。
 * 返り値の意味は fetchKitsuHits と同じ: hits は「画像が取れた ID → URL」、
 * unresolved は失敗・後回しで解決可否が不明な ID（呼び出し側は 'none' にしない）。
 * 404（MAL に作品が無い）と画像なしは miss としてどちらにも入れない。
 */
async function fetchMalPictureHits(
  malIds: number[],
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<{ hits: Map<number, string>; unresolved: Set<number> }> {
  const lookups = malIds.slice(0, MAL_MAX_LOOKUPS_PER_CALL);
  const hits = new Map<number, string>();
  const unresolved = new Set<number>(malIds.slice(MAL_MAX_LOOKUPS_PER_CALL));
  const results = await Promise.all(
    lookups.map((malId) => fetchMalPicture(malId, clientId, fetchImpl)),
  );
  for (const [index, result] of results.entries()) {
    const malId = lookups[index];
    if (malId === undefined) continue;
    if (result.failed) unresolved.add(malId);
    else if (result.url) hits.set(malId, result.url);
  }
  return { hits, unresolved };
}

/**
 * MAL API で 1 作品の main_picture を引く。
 * 404 は「MAL に無い」（failed=false, url=null）、それ以外の非 200・
 * ネットワーク失敗・解析失敗は failed=true（解決可否は不明）。
 */
async function fetchMalPicture(
  malId: number,
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<{ url: string | null; failed: boolean }> {
  const url = new URL(`${MAL_ANIME_ENDPOINT}/${malId}`);
  url.searchParams.set("fields", "main_picture");
  const res = await safeFetch(
    fetchImpl,
    url.toString(),
    { headers: { "X-MAL-CLIENT-ID": clientId } },
    REMOTE_FETCH_TIMEOUT_MS,
  );
  if (!res) return { url: null, failed: true };
  if (res.status === 404) return { url: null, failed: false };
  if (!res.ok) return { url: null, failed: true };

  let json: MalAnimeResponse;
  try {
    json = (await res.json()) as MalAnimeResponse;
  } catch {
    return { url: null, failed: true };
  }
  const picture = json?.main_picture?.large ?? json?.main_picture?.medium;
  return { url: picture || null, failed: false };
}

type MalAnimeResponse = {
  main_picture?: { large?: string | null; medium?: string | null } | null;
} | null;

/**
 * MAL mapping を持たない作品（kitsu_anime_id のみの行）を、Kitsu の作品
 * リソースを filter[id] でまとめて引いて解決する。
 * 返り値の意味は fetchKitsuHits と同じ: hits は「ポスターが取れた ID → URL」、
 * unresolved はバッチ失敗で解決可否が不明な ID（呼び出し側は 'none' にしない）。
 */
async function fetchKitsuPosterHits(
  kitsuIds: number[],
  fetchImpl: typeof fetch,
): Promise<{ hits: Map<number, string>; unresolved: Set<number> }> {
  const chunks: number[][] = [];
  for (let i = 0; i < kitsuIds.length; i += KITSU_BATCH_SIZE) {
    chunks.push(kitsuIds.slice(i, i + KITSU_BATCH_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) => fetchKitsuAnimePosters(chunk, fetchImpl)),
  );

  const hits = new Map<number, string>();
  const unresolved = new Set<number>();
  for (const [index, chunkResult] of results.entries()) {
    for (const [kitsuId, url] of chunkResult.hits) {
      hits.set(kitsuId, url);
    }
    if (!chunkResult.complete) {
      for (const kitsuId of chunks[index] ?? []) {
        if (!hits.has(kitsuId)) unresolved.add(kitsuId);
      }
    }
  }
  return { hits, unresolved };
}

/**
 * Kitsu の作品リソースを filter[id] でまとめて引き、Kitsu ID → ポスター URL
 * を返す。filter[id] は問い合わせた ID 分しか返らないので page[limit] が
 * チャンク内をすべて収める（1 ページで完結し、ページングは追わない）。
 * complete=false はリクエスト自体の失敗（= 未解決 ID の可否は不明）。
 */
async function fetchKitsuAnimePosters(
  kitsuIds: number[],
  fetchImpl: typeof fetch,
): Promise<{ hits: [number, string][]; complete: boolean }> {
  const url = new URL(KITSU_ANIME_ENDPOINT);
  url.searchParams.set("filter[id]", kitsuIds.join(","));
  url.searchParams.set("fields[anime]", "posterImage");
  url.searchParams.set("page[limit]", String(KITSU_BATCH_SIZE));

  const res = await safeFetch(
    fetchImpl,
    url.toString(),
    { headers: { Accept: "application/vnd.api+json" } },
    REMOTE_FETCH_TIMEOUT_MS,
  );
  if (!res || !res.ok) return { hits: [], complete: false };

  let json: KitsuAnimeListResponse;
  try {
    json = (await res.json()) as KitsuAnimeListResponse;
  } catch {
    return { hits: [], complete: false };
  }
  if (!Array.isArray(json.data)) return { hits: [], complete: false };

  // 問い合わせていない ID が返ってきても採用しない（フィルタの取り違え防止）。
  const requested = new Set(kitsuIds);
  const hits: [number, string][] = [];
  for (const item of json.data) {
    if (item?.type !== "anime" || !item.id) continue;
    const kitsuId = Number(item.id);
    if (!requested.has(kitsuId)) continue;
    const img = item.attributes?.posterImage;
    const poster = img?.large ?? img?.original ?? img?.medium ?? null;
    if (poster) hits.push([kitsuId, unescapeImageUrl(poster)]);
  }
  return { hits, complete: true };
}

type KitsuAnimeListResponse = {
  data?:
    | ({
        id?: string;
        type?: string;
        attributes?: {
          posterImage?: {
            large?: string | null;
            original?: string | null;
            medium?: string | null;
          } | null;
        } | null;
      } | null)[]
    | null;
};

/**
 * Kitsu の mappings（MAL ID → Kitsu 作品の対応表）で複数 MAL ID をまとめて解決する。
 * ポスター画像のある行だけを採用する。無い行は採用しないので、
 * 同一 MAL ID の重複行が次ページにあればそちらが拾える。
 * complete=false は「最後のページまで辿り切れなかった」（ネットワーク失敗・
 * 非 200 応答・JSON 解析失敗・ページ数上限）= 未解決 ID の可否は不明。
 */
async function fetchKitsuBatch(
  malIds: number[],
  fetchImpl: typeof fetch,
): Promise<{ hits: [number, string][]; complete: boolean }> {
  const { entries, complete } = await fetchKitsuMappingEntries(
    malIds,
    fetchImpl,
    (entry) => entry.posterUrl !== null,
  );
  const hits = [...entries].flatMap(([malId, entry]) =>
    entry.posterUrl ? [[malId, entry.posterUrl] as [number, string]] : [],
  );
  return { hits, complete };
}

/**
 * MAL ID → Kitsu 作品 ID を mappings で解決する。
 * キャラクター画像の名寄せ（characterImageFallback）のように、ポスター画像では
 * なく Kitsu 側のリソース ID そのものが要る用途向け（issue #227）。
 * 取れたものだけを返し、ネットワーク失敗・非 200 応答は空の結果で静かに返す。
 */
export async function fetchKitsuAnimeIds(
  malIds: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, string>> {
  const { entries } = await fetchKitsuMappingEntries(
    malIds,
    fetchImpl,
    () => true,
  );
  return new Map([...entries].map(([malId, entry]) => [malId, entry.animeId]));
}

/** mappings の 1 行から拾う解決結果。 */
type KitsuMappingEntry = {
  animeId: string;
  posterUrl: string | null;
};

/**
 * Kitsu の mappings をページングしながら解決し、MAL ID → 解決結果の Map を返す。
 * accept が false の行は採用しない（= 同一 MAL ID の後続行で解決できる可能性を残す）。
 * 採用された行が全 MAL ID 分揃った時点で打ち切る。
 * complete=false は途中でリクエストが失敗した / ページ数上限で打ち切った
 * ことを示し、未解決の ID は「Kitsu に無い」ではなく「不明」と扱うべき。
 */
async function fetchKitsuMappingEntries(
  malIds: number[],
  fetchImpl: typeof fetch,
  accept: (entry: KitsuMappingEntry) => boolean,
): Promise<{ entries: Map<number, KitsuMappingEntry>; complete: boolean }> {
  const out = new Map<number, KitsuMappingEntry>();
  if (malIds.length === 0) return { entries: out, complete: true };

  const first = new URL(KITSU_MAPPINGS_ENDPOINT);
  first.searchParams.set("filter[externalSite]", "myanimelist/anime");
  first.searchParams.set("filter[externalId]", malIds.join(","));
  first.searchParams.set("include", "item");
  first.searchParams.set("fields[anime]", "posterImage");
  first.searchParams.set("page[limit]", String(KITSU_BATCH_SIZE));

  // 問い合わせていない ID が返ってきても採用しない（フィルタの取り違え防止）。
  // 1 つの MAL ID に複数の Kitsu 作品が対応していたら、先に見つかった方を使う。
  const requested = new Set(malIds);

  // mappings の応答は「作品」ではなく「対応表の行」でページングされる。
  // 1 つの MAL ID に複数行ある作品が混ざると 20 件の問い合わせでも 20 行を
  // 超え、後続の ID が次ページに回るので links.next を追う。サブリクエスト
  // 予算を食い潰さないようページ数には上限を設ける。
  let next: string | null = first.toString();
  for (let page = 0; next && page < KITSU_MAX_PAGES; page++) {
    const res = await safeFetch(
      fetchImpl,
      next,
      { headers: { Accept: "application/vnd.api+json" } },
      REMOTE_FETCH_TIMEOUT_MS,
    );
    if (!res || !res.ok) return { entries: out, complete: false };

    let json: KitsuMappingsResponse;
    try {
      json = (await res.json()) as KitsuMappingsResponse;
    } catch {
      return { entries: out, complete: false };
    }

    const posterByAnimeId = new Map<string, string>();
    for (const item of json.included ?? []) {
      if (item?.type !== "anime" || !item.id) continue;
      const img = item.attributes?.posterImage;
      const poster = img?.large ?? img?.original ?? img?.medium ?? null;
      if (poster) posterByAnimeId.set(item.id, unescapeImageUrl(poster));
    }
    for (const mapping of json.data ?? []) {
      const malId = Number(mapping?.attributes?.externalId);
      if (!requested.has(malId) || out.has(malId)) continue;
      const item = mapping?.relationships?.item?.data;
      if (item?.type !== "anime" || !item.id) continue;
      const entry: KitsuMappingEntry = {
        animeId: item.id,
        posterUrl: posterByAnimeId.get(item.id) ?? null,
      };
      if (accept(entry)) out.set(malId, entry);
    }

    // 全 ID が解決済みなら次ページは不要。links.next は応答由来の URL なので、
    // Kitsu の mappings エンドポイント以外は追わない。
    next =
      out.size < requested.size && isKitsuMappingsPageUrl(json.links?.next)
        ? (json.links?.next ?? null)
        : null;
  }
  // next が残っている = ページ数上限で打ち切った or 途中で失敗したので、
  // 未解決 ID の解決可否は不明（complete=false）。
  return { entries: out, complete: next === null };
}

/**
 * 画像 URL に混入した `&amp;`（HTML エスケープ）を `&` に戻す。
 * Kitsu の応答自体は生の `&` を返すが、本番 DB に `&amp;` で入っている行が
 * 確認されたため、書き込み前に正規化しておく（読み側は workImage 側でも
 * 正規化している）。
 */
function unescapeImageUrl(url: string): string {
  return url.replace(/&amp;/g, "&");
}

type KitsuMappingsResponse = {
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
  links?: { next?: string | null } | null;
};

function isKitsuMappingsPageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const base = new URL(KITSU_MAPPINGS_ENDPOINT);
    return (
      parsed.protocol === "https:" &&
      parsed.host === base.host &&
      parsed.pathname === base.pathname
    );
  } catch {
    return false;
  }
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
