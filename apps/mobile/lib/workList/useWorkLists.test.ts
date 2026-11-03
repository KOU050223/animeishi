import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useWorkLists,
  useWorkListsContaining,
  useAddWorkToWorkList,
  useSavedWorkList,
  useSaveWorkList,
  useShareWorkList,
  useUnshareWorkList,
  useDeleteWorkList,
  usePublicWorkLists,
  useToggleWorkListLike,
  useReportWorkList,
} from "./useWorkLists";
import { loggedInUser, signedOutUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "@/__mocks__/@clerk/expo";

// apiClient の経路ごとの呼び出しをモックし、作品リストの
// フック（CRUD・共有・404 の扱い・キャッシュ更新）を検証する。
const mockListGet = jest.fn();
const mockDetailGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockItemsPost = jest.fn();
const mockSharePost = jest.fn();
const mockShareDelete = jest.fn();
const mockDelete = jest.fn();
const mockPublicGet = jest.fn();
const mockLikePut = jest.fn();
const mockLikeDelete = jest.fn();
const mockReportPost = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    "work-lists": {
      public: { $get: (...args: unknown[]) => mockPublicGet(...args) },
      ":id": {
        like: {
          $put: (...args: unknown[]) => mockLikePut(...args),
          $delete: (...args: unknown[]) => mockLikeDelete(...args),
        },
        report: { $post: (...args: unknown[]) => mockReportPost(...args) },
      },
    },
    me: {
      "work-lists": {
        $get: (...args: unknown[]) => mockListGet(...args),
        $post: (...args: unknown[]) => mockPost(...args),
        ":id": {
          $get: (...args: unknown[]) => mockDetailGet(...args),
          $put: (...args: unknown[]) => mockPut(...args),
          $delete: (...args: unknown[]) => mockDelete(...args),
          items: {
            $post: (...args: unknown[]) => mockItemsPost(...args),
          },
          share: {
            $post: (...args: unknown[]) => mockSharePost(...args),
            $delete: (...args: unknown[]) => mockShareDelete(...args),
          },
        },
      },
    },
  },
}));

function makeWrapper(
  client = new QueryClient({
    // gcTime は既定値のままにする。0 にするとミューテーションが
    // setQueryData した観測者なしのキャッシュが即座に GC され、
    // 「保存レスポンスをキャッシュに書く」検証自体が壊れる。
    defaultOptions: { queries: { retry: false } },
  }),
) {
  return {
    client,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  };
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const SAVED = {
  id: 7,
  title: "必修アニメリスト",
  description: "これを見れば話についていける",
  shareToken: null,
  items: [
    {
      annictWorkId: 1,
      position: 0,
      title: "作品A",
      hostedImageUrl: null,
    },
    {
      annictWorkId: 2,
      position: 1,
      title: "作品B",
      hostedImageUrl: "https://example.com/img.png",
    },
  ],
};

beforeEach(() => {
  resetAuth();
  jest.clearAllMocks();
  loggedInUser();
  setMockClerkState({ getToken: async () => "clerk_jwt" });
});

describe("useWorkLists", () => {
  it("自分の作品リストの一覧を返す", async () => {
    mockListGet.mockResolvedValue(
      okResponse([{ id: 7, title: "必修アニメリスト", itemCount: 2 }]),
    );
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useWorkLists(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(mockListGet).toHaveBeenCalledWith(
      { query: {} },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
  });

  it("サインアウト中はフェッチしない", async () => {
    signedOutUser();
    const { wrapper } = makeWrapper();
    await renderHook(() => useWorkLists(), { wrapper });
    expect(mockListGet).not.toHaveBeenCalled();
  });
});

describe("useWorkListsContaining", () => {
  it("contains クエリ付きで一覧を返す", async () => {
    mockListGet.mockResolvedValue(
      okResponse([
        { id: 7, title: "必修アニメリスト", itemCount: 2, containsWork: true },
      ]),
    );
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useWorkListsContaining(42), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0]?.containsWork).toBe(true);
    expect(mockListGet).toHaveBeenCalledWith(
      { query: { contains: "42" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
  });

  it("annictWorkId が null の間はフェッチしない", async () => {
    const { wrapper } = makeWrapper();
    await renderHook(() => useWorkListsContaining(null), { wrapper });
    expect(mockListGet).not.toHaveBeenCalled();
  });
});

describe("useAddWorkToWorkList", () => {
  it("items エンドポイントに POST し、レスポンスを detail キャッシュに書き込む", async () => {
    mockItemsPost.mockResolvedValue(okResponse(SAVED));
    const { client, wrapper } = makeWrapper();
    const { result } = await renderHook(() => useAddWorkToWorkList(), {
      wrapper,
    });

    result.current.mutate({ listId: 7, annictWorkId: 2 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockItemsPost).toHaveBeenCalledWith(
      { param: { id: "7" }, json: { annictWorkId: 2 } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    expect(client.getQueryData(["work-list", "saved", 7])).toEqual(SAVED);
  });

  it("追加後に一覧（contains 付き含む）を無効化する", async () => {
    mockItemsPost.mockResolvedValue(okResponse(SAVED));
    const { client, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");
    const { result } = await renderHook(() => useAddWorkToWorkList(), {
      wrapper,
    });

    result.current.mutate({ listId: 7, annictWorkId: 2 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // ["work-list", "list"] プレフィックスで contains 派生キーも無効化される
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["work-list", "list"],
    });
  });
});

describe("useSavedWorkList", () => {
  it("保存済みのリストを返す", async () => {
    mockDetailGet.mockResolvedValue(okResponse(SAVED));
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSavedWorkList(7), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data?.id).toBe(7));
    expect(mockDetailGet).toHaveBeenCalledWith(
      { param: { id: "7" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
  });

  it("404 はエラーではなく null になる（削除済みのリストを開いた場合）", async () => {
    mockDetailGet.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSavedWorkList(7), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("id が null の間はフェッチしない（新規作成中）", async () => {
    const { wrapper } = makeWrapper();
    await renderHook(() => useSavedWorkList(null), { wrapper });
    expect(mockDetailGet).not.toHaveBeenCalled();
  });
});

describe("useSaveWorkList", () => {
  it("id が無ければ POST で新規作成する", async () => {
    mockPost.mockResolvedValue(okResponse(SAVED));
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSaveWorkList(), { wrapper });

    result.current.mutate({
      title: "必修アニメリスト",
      description: "これを見れば話についていける",
      items: [{ annictWorkId: 1 }, { annictWorkId: 2 }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith(
      {
        json: {
          title: "必修アニメリスト",
          description: "これを見れば話についていける",
          items: [{ annictWorkId: 1 }, { annictWorkId: 2 }],
        },
      },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("id があれば PUT で更新する", async () => {
    mockPut.mockResolvedValue(okResponse(SAVED));
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSaveWorkList(), { wrapper });

    result.current.mutate({
      id: 7,
      title: "必修アニメリスト",
      description: "これを見れば話についていける",
      items: [{ annictWorkId: 2 }, { annictWorkId: 1 }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPut).toHaveBeenCalledWith(
      {
        param: { id: "7" },
        json: {
          title: "必修アニメリスト",
          description: "これを見れば話についていける",
          items: [{ annictWorkId: 2 }, { annictWorkId: 1 }],
        },
      },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("保存レスポンスを detail キャッシュに直接書き込む", async () => {
    mockPut.mockResolvedValue(okResponse(SAVED));
    const { client, wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSaveWorkList(), { wrapper });

    result.current.mutate({
      id: 7,
      title: "必修アニメリスト",
      description: "",
      items: [{ annictWorkId: 1 }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(["work-list", "saved", 7])).toEqual(SAVED);
  });
});

describe("useShareWorkList", () => {
  it("共有トークンを発行し、detail キャッシュの shareToken を更新する", async () => {
    mockSharePost.mockResolvedValue(okResponse({ shareToken: "tok-1" }));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(["work-list", "saved", 7], SAVED);

    const { result } = await renderHook(() => useShareWorkList(), { wrapper });
    result.current.mutate(7);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockSharePost).toHaveBeenCalledWith(
      { param: { id: "7" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    expect(
      client.getQueryData<{ shareToken: string }>(["work-list", "saved", 7])
        ?.shareToken,
    ).toBe("tok-1");
  });
});

describe("useUnshareWorkList", () => {
  it("共有トークンを解除し、detail キャッシュの shareToken を null にする", async () => {
    mockShareDelete.mockResolvedValue(okResponse({ ok: true }));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(["work-list", "saved", 7], {
      ...SAVED,
      shareToken: "tok-1",
    });

    const { result } = await renderHook(() => useUnshareWorkList(), {
      wrapper,
    });
    result.current.mutate(7);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShareDelete).toHaveBeenCalledWith(
      { param: { id: "7" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    expect(
      client.getQueryData<{ shareToken: string | null }>([
        "work-list",
        "saved",
        7,
      ])?.shareToken,
    ).toBeNull();
  });
});

describe("useDeleteWorkList", () => {
  it("削除して detail キャッシュを消し、一覧を無効化する", async () => {
    mockDelete.mockResolvedValue(okResponse({ ok: true }));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(["work-list", "saved", 7], SAVED);
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useDeleteWorkList(), {
      wrapper,
    });
    result.current.mutate(7);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(["work-list", "saved", 7])).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["work-list", "list"],
    });
  });
});

const PUBLIC_ITEM = {
  id: 3,
  title: "みんなのおすすめ",
  description: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  owner: { userId: "other-user", username: "other", profileImageUrl: null },
  itemCount: 5,
  likeCount: 12,
  likedByMe: false,
  thumbnails: [],
};

describe("usePublicWorkLists", () => {
  it("公開一覧を sort/limit 付きで取得する", async () => {
    mockPublicGet.mockResolvedValue(
      okResponse({ items: [PUBLIC_ITEM], nextCursor: "12_3" }),
    );
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => usePublicWorkLists("likes"), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.data?.pages[0]?.items).toHaveLength(1),
    );
    expect(mockPublicGet).toHaveBeenCalledWith(
      { query: { sort: "likes", limit: "20" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
  });

  it("nextCursor がある限り続きのページを取れる", async () => {
    mockPublicGet
      .mockResolvedValueOnce(
        okResponse({ items: [PUBLIC_ITEM], nextCursor: "12_3" }),
      )
      .mockResolvedValueOnce(
        okResponse({
          items: [{ ...PUBLIC_ITEM, id: 2 }],
          nextCursor: null,
        }),
      );
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => usePublicWorkLists("likes"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await result.current.fetchNextPage();

    await waitFor(() =>
      expect(result.current.data?.pages.flatMap((p) => p.items)).toHaveLength(
        2,
      ),
    );
    expect(mockPublicGet).toHaveBeenLastCalledWith(
      { query: { sort: "likes", limit: "20", cursor: "12_3" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    expect(result.current.hasNextPage).toBe(false);
  });

  it("サインアウト中はフェッチしない", async () => {
    signedOutUser();
    const { wrapper } = makeWrapper();
    await renderHook(() => usePublicWorkLists("new"), { wrapper });
    expect(mockPublicGet).not.toHaveBeenCalled();
  });
});

describe("useToggleWorkListLike", () => {
  it("いいねすると PUT を呼び、両ソートのキャッシュを応答で更新する", async () => {
    mockLikePut.mockResolvedValue(
      okResponse({ likeCount: 13, likedByMe: true }),
    );
    const { client, wrapper } = makeWrapper();
    for (const sort of ["likes", "new"] as const) {
      client.setQueryData(["work-list", "public", sort], {
        pages: [{ items: [PUBLIC_ITEM], nextCursor: null }],
      });
    }

    const { result } = await renderHook(() => useToggleWorkListLike(), {
      wrapper,
    });
    result.current.mutate({ id: 3, like: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockLikePut).toHaveBeenCalledWith(
      { param: { id: "3" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    for (const sort of ["likes", "new"] as const) {
      const cached = client.getQueryData<{
        pages: { items: (typeof PUBLIC_ITEM)[] }[];
      }>(["work-list", "public", sort]);
      expect(cached?.pages[0]?.items[0]?.likeCount).toBe(13);
      expect(cached?.pages[0]?.items[0]?.likedByMe).toBe(true);
    }
  });

  it("いいねを取り消すと DELETE を呼ぶ", async () => {
    mockLikeDelete.mockResolvedValue(
      okResponse({ likeCount: 11, likedByMe: false }),
    );
    const { client, wrapper } = makeWrapper();
    client.setQueryData(["work-list", "public", "likes"], {
      pages: [
        { items: [{ ...PUBLIC_ITEM, likedByMe: true }], nextCursor: null },
      ],
    });

    const { result } = await renderHook(() => useToggleWorkListLike(), {
      wrapper,
    });
    result.current.mutate({ id: 3, like: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockLikeDelete).toHaveBeenCalledWith(
      { param: { id: "3" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
  });
});

describe("useReportWorkList", () => {
  it("理由を POST する", async () => {
    mockReportPost.mockResolvedValue(okResponse({ success: true }));
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReportWorkList(), {
      wrapper,
    });
    result.current.mutate({ id: 3, reason: "不適切な内容" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockReportPost).toHaveBeenCalledWith(
      { param: { id: "3" }, json: { reason: "不適切な内容" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
  });

  it("429 はサーバーの理由メッセージを投げる", async () => {
    mockReportPost.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "通報は1時間に5回までです" }),
    });
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useReportWorkList(), {
      wrapper,
    });
    result.current.mutate({ id: 3, reason: "スパム" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("通報は1時間に5回までです");
  });
});
