import { describe, it, expect, vi } from "vitest";
import {
  AnnictApiError,
  annictGraphQL,
  exchangeAnnictCode,
  fetchAnnictLibraryEntries,
  fetchAnnictTokenInfo,
  fetchAnnictWorkByAnnictId,
  searchAnnictWorksByTitle,
  ANNICT_GRAPHQL_ENDPOINT,
  ANNICT_TOKEN_ENDPOINT,
  ANNICT_TOKEN_INFO_ENDPOINT,
} from "@/lib/annict";
import {
  isPersistableState,
  ANNICT_ALL_STATUS_STATES,
} from "@/lib/annict/statusState";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("annictGraphQL", () => {
  it("Authorization ヘッダと query/variables を載せて POST する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { viewer: { id: 1 } } }));

    const data = await annictGraphQL<{ viewer: { id: number } }>(
      "tok_abc",
      "query { viewer { id } }",
      { foo: "bar" },
      fetchMock as unknown as typeof fetch,
    );

    expect(data).toEqual({ viewer: { id: 1 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ANNICT_GRAPHQL_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok_abc");
    expect(JSON.parse(init.body)).toEqual({
      query: "query { viewer { id } }",
      variables: { foo: "bar" },
    });
  });

  it("GraphQL errors を AnnictApiError に変換する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ errors: [{ message: "boom" }] }));

    await expect(
      annictGraphQL("t", "q", {}, fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ name: "AnnictApiError", message: "boom" });
  });

  it("HTTP エラーを status 付き AnnictApiError にする", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      annictGraphQL("t", "q", {}, fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("fetch の reject（ネットワーク障害）を AnnictApiError(status=0) に正規化する", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      annictGraphQL("t", "q", {}, fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ name: "AnnictApiError", status: 0 });
  });

  it("2xx の非 JSON 応答を AnnictApiError に正規化する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("<html>not json</html>", { status: 200 }),
      );

    await expect(
      annictGraphQL("t", "q", {}, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(AnnictApiError);
  });
});

describe("exchangeAnnictCode", () => {
  it("authorization_code grant を form-encoded で送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "at_123",
        token_type: "bearer",
        scope: "read write",
        created_at: 1700000000,
      }),
    );

    const token = await exchangeAnnictCode(
      {
        code: "code_xyz",
        clientId: "cid",
        clientSecret: "secret",
        redirectUri: "animeishi://annict",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(token.access_token).toBe("at_123");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ANNICT_TOKEN_ENDPOINT);
    const params = new URLSearchParams(init.body as string);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("code_xyz");
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("client_secret")).toBe("secret");
    expect(params.get("redirect_uri")).toBe("animeishi://annict");
  });

  it("失敗時は status 付き AnnictApiError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("invalid_grant", { status: 400 }));

    await expect(
      exchangeAnnictCode(
        {
          code: "bad",
          clientId: "c",
          clientSecret: "s",
          redirectUri: "r",
        },
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ name: "AnnictApiError", status: 400 });
  });
});

describe("fetchAnnictLibraryEntries", () => {
  function libraryPage(
    nodes: unknown[],
    pageInfo: { hasNextPage: boolean; endCursor: string | null },
  ): Response {
    return jsonResponse({
      data: { viewer: { libraryEntries: { pageInfo, nodes } } },
    });
  }

  function node(
    annictId: number,
    state: string | null,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      status: state === null ? null : { state },
      work: {
        annictId,
        title: `作品${annictId}`,
        titleKana: null,
        titleEn: null,
        seasonName: "2026-spring",
        seasonYear: 2026,
        image: { recommendedImageUrl: `https://img/${annictId}.jpg` },
        ...overrides,
      },
    };
  }

  it("全ページを after カーソルで辿って平坦化する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        libraryPage([node(1, "WATCHING")], {
          hasNextPage: true,
          endCursor: "cursor1",
        }),
      )
      .mockResolvedValueOnce(
        libraryPage([node(2, "WATCHED")], {
          hasNextPage: false,
          endCursor: null,
        }),
      );

    const entries = await fetchAnnictLibraryEntries(
      "tok",
      fetchMock as unknown as typeof fetch,
    );

    expect(entries.map((e) => e.annictWorkId)).toEqual([1, 2]);
    expect(entries[0]?.state).toBe("WATCHING");
    expect(entries[0]?.imageUrl).toBe("https://img/1.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 2 ページ目は前ページの endCursor を after に載せる
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondBody.variables.after).toBe("cursor1");
  });

  it("work が null のノードはスキップする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      libraryPage(
        [node(1, "WATCHING"), { status: { state: "WATCHED" }, work: null }],
        {
          hasNextPage: false,
          endCursor: null,
        },
      ),
    );

    const entries = await fetchAnnictLibraryEntries(
      "tok",
      fetchMock as unknown as typeof fetch,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.annictWorkId).toBe(1);
  });

  it("status が null のノードは state=null で返す（呼び出し側で保存可否を判定）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        libraryPage([node(3, null)], { hasNextPage: false, endCursor: null }),
      );

    const entries = await fetchAnnictLibraryEntries(
      "tok",
      fetchMock as unknown as typeof fetch,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.state).toBeNull();
  });

  it("recommendedImageUrl が空なら別の Annict 画像 URL にフォールバックする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      libraryPage(
        [
          node(4, "WATCHING", {
            image: {
              recommendedImageUrl: null,
              facebookOgImageUrl: "https://img/4-og.jpg",
              twitterBiggerAvatarUrl: "https://img/4-twitter-bigger.jpg",
              twitterAvatarUrl: "https://img/4-twitter.jpg",
              twitterNormalAvatarUrl: "https://img/4-twitter-normal.jpg",
              twitterMiniAvatarUrl: "https://img/4-twitter-mini.jpg",
            },
          }),
        ],
        { hasNextPage: false, endCursor: null },
      ),
    );

    const entries = await fetchAnnictLibraryEntries(
      "tok",
      fetchMock as unknown as typeof fetch,
    );

    expect(entries[0]?.imageUrl).toBe("https://img/4-og.jpg");
  });

  it("Annict の internalUrl が返る場合は最優先で使う", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      libraryPage(
        [
          node(6, "WATCHING", {
            image: {
              internalUrl: "https://imgproxy.annict.test/works/6.jpg",
              recommendedImageUrl: "https://img/6-recommended.jpg",
              facebookOgImageUrl: "https://img/6-og.jpg",
              twitterBiggerAvatarUrl: "https://img/6-twitter-bigger.jpg",
              twitterAvatarUrl: "https://img/6-twitter.jpg",
              twitterNormalAvatarUrl: "https://img/6-twitter-normal.jpg",
              twitterMiniAvatarUrl: "https://img/6-twitter-mini.jpg",
            },
          }),
        ],
        { hasNextPage: false, endCursor: null },
      ),
    );

    const entries = await fetchAnnictLibraryEntries(
      "tok",
      fetchMock as unknown as typeof fetch,
    );

    expect(entries[0]?.imageUrl).toBe(
      "https://imgproxy.annict.test/works/6.jpg",
    );
  });

  it("hasNextPage が true でも endCursor が null なら止まる（無限ループ防止）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      libraryPage([node(1, "WATCHING")], {
        hasNextPage: true,
        endCursor: null,
      }),
    );

    const entries = await fetchAnnictLibraryEntries(
      "tok",
      fetchMock as unknown as typeof fetch,
    );

    expect(entries).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("同一 endCursor が再出現したら AnnictApiError(502) で失敗（部分同期を成功扱いにしない）", async () => {
    // 壊れたページング: 常に hasNextPage=true で同じ cursor を返し続ける。
    // ここで break して部分データを返すと、呼び出し側の全置換で履歴が欠ける。
    // Response の body は一度しか読めないため、呼び出しごとに新しい Response を返す。
    const fetchMock = vi.fn().mockImplementation(() =>
      libraryPage([node(1, "WATCHING")], {
        hasNextPage: true,
        endCursor: "stuck",
      }),
    );

    await expect(
      fetchAnnictLibraryEntries("tok", fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({
      name: "AnnictApiError",
      status: 502,
    });
  });

  it("viewer が null（未認証相当）なら空配列", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { viewer: null } }));

    const entries = await fetchAnnictLibraryEntries(
      "tok",
      fetchMock as unknown as typeof fetch,
    );

    expect(entries).toEqual([]);
  });
});

describe("fetchAnnictWorkByAnnictId", () => {
  it("annictId から取得した作品でも画像 URL をフォールバックする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          searchWorks: {
            nodes: [
              {
                id: "node-10",
                annictId: 10,
                title: "作品10",
                titleKana: null,
                titleEn: null,
                seasonName: null,
                seasonYear: null,
                image: {
                  recommendedImageUrl: null,
                  facebookOgImageUrl: null,
                  twitterBiggerAvatarUrl: "https://img/10-twitter-bigger.jpg",
                  twitterAvatarUrl: "https://img/10-twitter.jpg",
                  twitterNormalAvatarUrl: "https://img/10-twitter-normal.jpg",
                  twitterMiniAvatarUrl: "https://img/10-twitter-mini.jpg",
                },
              },
            ],
          },
        },
      }),
    );

    const work = await fetchAnnictWorkByAnnictId(
      "tok",
      10,
      fetchMock as unknown as typeof fetch,
    );

    expect(work?.imageUrl).toBe("https://img/10-twitter-bigger.jpg");
  });
});

describe("fetchAnnictTokenInfo", () => {
  it("Bearer トークンで token/info を叩き所有者を返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        resource_owner_id: 42,
        scope: ["read", "write"],
        expires_in: null,
        created_at: 1700000000,
      }),
    );

    const info = await fetchAnnictTokenInfo(
      "tok",
      fetchMock as unknown as typeof fetch,
    );

    expect(info.resource_owner_id).toBe(42);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ANNICT_TOKEN_INFO_ENDPOINT);
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("401 は AnnictApiError(status=401)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 401 }));

    await expect(
      fetchAnnictTokenInfo("bad", fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("searchAnnictWorksByTitle", () => {
  function searchPage(
    nodes: unknown[],
    pageInfo: { hasNextPage: boolean; endCursor: string | null },
  ): Response {
    return jsonResponse({ data: { searchWorks: { pageInfo, nodes } } });
  }

  function workNode(annictId: number, overrides: Record<string, unknown> = {}) {
    return {
      id: `node-${annictId}`,
      annictId,
      title: `作品${annictId}`,
      titleKana: null,
      titleEn: null,
      seasonName: "2026-spring",
      seasonYear: 2026,
      image: { recommendedImageUrl: `https://img/${annictId}.jpg` },
      ...overrides,
    };
  }

  it("タイトルで検索し作品メタを整形して返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      searchPage([workNode(1), workNode(2)], {
        hasNextPage: true,
        endCursor: "cursor1",
      }),
    );

    const result = await searchAnnictWorksByTitle(
      "tok",
      "進撃",
      null,
      fetchMock as unknown as typeof fetch,
    );

    expect(result.works.map((w) => w.annictWorkId)).toEqual([1, 2]);
    expect(result.works[0]?.nodeId).toBe("node-1");
    expect(result.works[0]?.state).toBeNull();
    expect(result.works[0]?.imageUrl).toBe("https://img/1.jpg");
    expect(result.hasNextPage).toBe(true);
    expect(result.endCursor).toBe("cursor1");

    // GraphQL 変数に titles と after が載る
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.variables.titles).toEqual(["進撃"]);
    expect(body.variables.after).toBeNull();
  });

  it("after カーソルを variables に載せる", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        searchPage([workNode(3)], { hasNextPage: false, endCursor: null }),
      );

    await searchAnnictWorksByTitle(
      "tok",
      "鬼滅",
      "cursorX",
      fetchMock as unknown as typeof fetch,
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.variables.after).toBe("cursorX");
  });

  it("searchWorks が null なら空結果を返す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { searchWorks: null } }));

    const result = await searchAnnictWorksByTitle(
      "tok",
      "存在しない",
      null,
      fetchMock as unknown as typeof fetch,
    );

    expect(result.works).toHaveLength(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.endCursor).toBeNull();
  });

  it("検索結果でも画像 URL をフォールバックする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      searchPage(
        [
          workNode(5, {
            image: {
              recommendedImageUrl: null,
              facebookOgImageUrl: null,
              twitterBiggerAvatarUrl: null,
              twitterAvatarUrl: "https://img/5-twitter.jpg",
              twitterNormalAvatarUrl: "https://img/5-twitter-normal.jpg",
              twitterMiniAvatarUrl: "https://img/5-twitter-mini.jpg",
            },
          }),
        ],
        { hasNextPage: false, endCursor: null },
      ),
    );

    const result = await searchAnnictWorksByTitle(
      "tok",
      "作品5",
      null,
      fetchMock as unknown as typeof fetch,
    );

    expect(result.works[0]?.imageUrl).toBe("https://img/5-twitter.jpg");
  });
});

describe("isPersistableState", () => {
  it("D1 保存可能な 5 値は true", () => {
    for (const s of [
      "WATCHING",
      "WATCHED",
      "ON_HOLD",
      "STOP_WATCHING",
      "WANNA_WATCH",
    ]) {
      expect(isPersistableState(s)).toBe(true);
    }
  });

  it("NO_STATE / null / 未知の値は false", () => {
    expect(isPersistableState("NO_STATE")).toBe(false);
    expect(isPersistableState(null)).toBe(false);
    expect(isPersistableState(undefined)).toBe(false);
    expect(isPersistableState("FOO")).toBe(false);
  });

  it("ANNICT_ALL_STATUS_STATES は NO_STATE を含む", () => {
    expect(ANNICT_ALL_STATUS_STATES).toContain("NO_STATE");
  });
});
