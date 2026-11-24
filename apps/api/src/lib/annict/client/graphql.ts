export const ANNICT_GRAPHQL_ENDPOINT = "https://api.annict.com/graphql";

/** Annict 通信が失敗したことを表すエラー。HTTP ステータスを保持する。 */
export class AnnictApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AnnictApiError";
  }
}

/**
 * リクエストごとのサブリクエスト予算を使い切ったとき、予算付き fetch が
 * 投げるエラー（issue #219）。Workers のサブリクエスト上限（Free プラン
 * 50/req）は D1・KV・外部 fetch の全てを数えるため、Annict への往復を
 * 自前の予算で打ち切る。このエラーが呼び出し側に届いたら「検索しなかった」
 * （pending）として扱う。上流障害（AnnictApiError の 0/5xx）とは別系統。
 */
export class AnnictBudgetExhaustedError extends AnnictApiError {
  constructor() {
    super("Subrequest budget exhausted", 0);
    this.name = "AnnictBudgetExhaustedError";
  }
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

// Annict のコネクションはスキーマ上 nodes 自体と要素が nullable で、
// エラー無しでも欠損がありうる。取れた分だけを「全件」として使うと
// 呼び出し側（履歴の全置換・話対応付け等）を誤認させるため、null の
// nodes / null 要素は上流の不完全な応答として失敗にする。
export function requireAnnictNodes<T>(
  nodes: readonly (T | null)[] | null | undefined,
  context: string,
): T[] {
  if (nodes == null || nodes.some((n) => n == null)) {
    throw new AnnictApiError(
      `Annict ${context} returned incomplete nodes`,
      502,
    );
  }
  return nodes as T[];
}

// Annict との通信失敗（ネットワーク障害・タイムアウト等）も AnnictApiError に正規化する。
// これがないと fetch の reject がそのまま漏れ、features/annict/index.ts の
// `instanceof AnnictApiError` 分岐を通らず一時障害が 500 扱いに崩れる。
export async function annictFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  context: string,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (err) {
    // AnnictApiError 系はそのまま透過する。予算付き fetch が投げる
    // AnnictBudgetExhaustedError を status 0 の通信失敗に包み替えると、
    // リトライ対象・上流障害と区別できなくなるため（issue #219）。
    if (err instanceof AnnictApiError) throw err;
    // status 0 は「HTTP 応答に到達しなかった（接続失敗）」を表す。
    throw new AnnictApiError(`Annict ${context} request failed`, 0, err);
  }
}

// 2xx 応答の JSON 解析失敗（非 JSON 応答など）も AnnictApiError に正規化する。
export async function annictParseJson<T>(
  res: Response,
  context: string,
): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new AnnictApiError(
      `Annict ${context} returned invalid JSON`,
      res.status,
      err,
    );
  }
}

/**
 * Annict GraphQL に対してクエリ/ミューテーションを実行する。
 * `accessToken` は Annict のアクセストークン（X-Annict-Token で運ばれてきたもの）。
 */
export async function annictGraphQL<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
  // 部分的な失敗として受け入れるエラー。全エラーがこれに当てはまり data が
  // あるときだけ、例外にせず data を返す（null になった箇所は呼び出し側で扱う）。
  isToleratedError?: (error: { message: string }) => boolean,
): Promise<T> {
  const res = await annictFetch(
    fetchImpl,
    ANNICT_GRAPHQL_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    },
    "GraphQL",
  );

  if (!res.ok) {
    throw new AnnictApiError(
      `Annict GraphQL request failed (${res.status})`,
      res.status,
      await safeReadText(res),
    );
  }

  const json = await annictParseJson<GraphQLResponse<T>>(res, "GraphQL");
  const tolerated =
    isToleratedError !== undefined &&
    json.data !== undefined &&
    json.data !== null &&
    (json.errors ?? []).every(isToleratedError);
  if (json.errors?.length && !tolerated) {
    throw new AnnictApiError(
      json.errors.map((e) => e.message).join("; "),
      res.status,
      json.errors,
    );
  }
  if (json.data === undefined) {
    throw new AnnictApiError("Annict GraphQL returned no data", res.status);
  }
  return json.data;
}

export async function safeReadText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
