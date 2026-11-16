import { describe, expect, it } from "vitest";
import { AnnictApiError } from "./client";
import {
  AnnictSharedTokenRejectedError,
  createAnnictWorkCatalog,
  type AnnictWorkCatalog,
} from "./workCatalog";

type SentRequest = { authorization: string | null; query: string };

// Annict GraphQL への送信内容を記録し、どのクエリにも通る空の応答を返す。
function recordingFetch(status = 200): {
  fetchImpl: typeof fetch;
  sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(init?.body as string) as { query: string };
    sent.push({
      authorization: headers.get("Authorization"),
      query: body.query,
    });
    return new Response(
      JSON.stringify({
        data: {
          searchWorks: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
        },
      }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return { fetchImpl, sent };
}

// AnnictWorkCatalog の全メソッドを 1 回ずつ呼ぶ。メソッドを足したらここにも足す
// （satisfies で呼び忘れを型エラーにする）。
async function callEveryMethod(catalog: AnnictWorkCatalog): Promise<void> {
  const calls = {
    searchByTitle: () => catalog.searchByTitle("進撃", null),
    searchBySeason: () => catalog.searchBySeason("2026-spring", null),
    searchByIds: () => catalog.searchByIds([1, 2]),
    fetchWork: () => catalog.fetchWork(1),
    fetchWorkDetail: () => catalog.fetchWorkDetail(1),
    fetchWorkCasts: () => catalog.fetchWorkCasts(1),
  } satisfies Record<Exclude<keyof AnnictWorkCatalog, "source">, unknown>;
  for (const call of Object.values(calls)) await call();
}

describe("createAnnictWorkCatalog", () => {
  it("共用トークンではどのメソッドも利用者情報（viewer 系フィールド）を問い合わせない", async () => {
    const { fetchImpl, sent } = recordingFetch();
    await callEveryMethod(
      createAnnictWorkCatalog("shared_tok", "shared", fetchImpl),
    );

    expect(sent.length).toBeGreaterThanOrEqual(6);
    for (const req of sent) {
      expect(req.authorization).toBe("Bearer shared_tok");
      expect(req.query).not.toMatch(/viewer/i);
    }
  });

  it("本人のトークンでは作品詳細に視聴ステータス（viewerStatusState）を含める", async () => {
    const { fetchImpl, sent } = recordingFetch();
    await createAnnictWorkCatalog(
      "user_tok",
      "user",
      fetchImpl,
    ).fetchWorkDetail(1);

    expect(sent[0]?.authorization).toBe("Bearer user_tok");
    expect(sent[0]?.query).toContain("viewerStatusState");
  });

  it("共用トークンが 401 で拒否されたら AnnictSharedTokenRejectedError にする", async () => {
    const { fetchImpl } = recordingFetch(401);
    const catalog = createAnnictWorkCatalog("shared_tok", "shared", fetchImpl);

    await expect(catalog.searchByTitle("進撃", null)).rejects.toBeInstanceOf(
      AnnictSharedTokenRejectedError,
    );
  });

  it("本人のトークンの 401 は従来どおり AnnictApiError のまま投げる", async () => {
    const { fetchImpl } = recordingFetch(401);
    const catalog = createAnnictWorkCatalog("user_tok", "user", fetchImpl);

    const err = await catalog.searchByTitle("進撃", null).catch((e) => e);
    expect(err).toBeInstanceOf(AnnictApiError);
    expect(err).not.toBeInstanceOf(AnnictSharedTokenRejectedError);
    expect((err as AnnictApiError).status).toBe(401);
  });

  it("共用トークンでも 401 以外の失敗（429 等）は包み替えない", async () => {
    const { fetchImpl } = recordingFetch(429);
    const catalog = createAnnictWorkCatalog("shared_tok", "shared", fetchImpl);

    const err = await catalog.searchByIds([1]).catch((e) => e);
    expect(err).not.toBeInstanceOf(AnnictSharedTokenRejectedError);
    expect((err as AnnictApiError).status).toBe(429);
  });
});
