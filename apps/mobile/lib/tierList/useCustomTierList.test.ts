import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useCustomTierLists,
  useSavedCustomTierList,
  useSaveCustomTierList,
  useShareCustomTierList,
  useDeleteCustomTierList,
} from "./useCustomTierList";
import { loggedInUser, signedOutUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "@/__mocks__/@clerk/expo";
import { DEFAULT_TIERS } from "./defaults";

// apiClient の経路ごとの呼び出しをモックし、自由作成 tier 表の
// フック（CRUD・共有・404 の扱い・キャッシュ更新）を検証する。
const mockListGet = jest.fn();
const mockDetailGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockSharePost = jest.fn();
const mockDelete = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      "custom-tier-lists": {
        $get: (...args: unknown[]) => mockListGet(...args),
        $post: (...args: unknown[]) => mockPost(...args),
        ":id": {
          $get: (...args: unknown[]) => mockDetailGet(...args),
          $put: (...args: unknown[]) => mockPut(...args),
          $delete: (...args: unknown[]) => mockDelete(...args),
          share: { $post: (...args: unknown[]) => mockSharePost(...args) },
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
  title: "歴代で好きなアニメ",
  tiersJson: JSON.stringify(DEFAULT_TIERS),
  shareToken: null,
  items: [
    { annictWorkId: 1, tierKey: "0", title: "作品A", hostedImageUrl: null },
  ],
};

beforeEach(() => {
  resetAuth();
  jest.clearAllMocks();
  loggedInUser();
  setMockClerkState({ getToken: async () => "clerk_jwt" });
});

describe("useCustomTierLists", () => {
  it("自分の自由作成 tier 表の一覧を返す", async () => {
    mockListGet.mockResolvedValue(okResponse([SAVED]));
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useCustomTierLists(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(mockListGet).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
  });

  it("サインアウト中はフェッチしない", async () => {
    signedOutUser();
    const { wrapper } = makeWrapper();
    await renderHook(() => useCustomTierLists(), { wrapper });
    expect(mockListGet).not.toHaveBeenCalled();
  });
});

describe("useSavedCustomTierList", () => {
  it("保存済みの表を返す", async () => {
    mockDetailGet.mockResolvedValue(okResponse(SAVED));
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSavedCustomTierList(7), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data?.id).toBe(7));
    expect(mockDetailGet).toHaveBeenCalledWith(
      { param: { id: "7" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
  });

  it("404 はエラーではなく null になる（削除済みの表を開いた場合）", async () => {
    mockDetailGet.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSavedCustomTierList(7), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("id が null の間はフェッチしない（新規作成中）", async () => {
    const { wrapper } = makeWrapper();
    await renderHook(() => useSavedCustomTierList(null), { wrapper });
    expect(mockDetailGet).not.toHaveBeenCalled();
  });
});

describe("useSaveCustomTierList", () => {
  it("id が無ければ POST で新規作成する", async () => {
    mockPost.mockResolvedValue(okResponse(SAVED));
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSaveCustomTierList(), {
      wrapper,
    });

    result.current.mutate({
      title: "歴代で好きなアニメ",
      tiers: DEFAULT_TIERS,
      items: [{ annictWorkId: 1, tierKey: "0" }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith(
      {
        json: {
          title: "歴代で好きなアニメ",
          tiers: DEFAULT_TIERS,
          items: [{ annictWorkId: 1, tierKey: "0" }],
        },
      },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("id があれば PUT で更新する", async () => {
    mockPut.mockResolvedValue(okResponse(SAVED));
    const { wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSaveCustomTierList(), {
      wrapper,
    });

    result.current.mutate({
      id: 7,
      title: "歴代で好きなアニメ",
      tiers: DEFAULT_TIERS,
      items: [{ annictWorkId: 1, tierKey: "0" }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPut).toHaveBeenCalledWith(
      {
        param: { id: "7" },
        json: {
          title: "歴代で好きなアニメ",
          tiers: DEFAULT_TIERS,
          items: [{ annictWorkId: 1, tierKey: "0" }],
        },
      },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("保存レスポンスを detail キャッシュに直接書き込む", async () => {
    mockPut.mockResolvedValue(okResponse(SAVED));
    const { client, wrapper } = makeWrapper();
    const { result } = await renderHook(() => useSaveCustomTierList(), {
      wrapper,
    });

    result.current.mutate({
      id: 7,
      title: "歴代で好きなアニメ",
      tiers: DEFAULT_TIERS,
      items: [{ annictWorkId: 1, tierKey: "0" }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(["custom-tier-list", "saved", 7])).toEqual(
      SAVED,
    );
  });
});

describe("useShareCustomTierList", () => {
  it("共有トークンを発行し、detail キャッシュの shareToken を更新する", async () => {
    mockSharePost.mockResolvedValue(okResponse({ shareToken: "tok-1" }));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(["custom-tier-list", "saved", 7], SAVED);

    const { result } = await renderHook(() => useShareCustomTierList(), {
      wrapper,
    });
    result.current.mutate(7);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockSharePost).toHaveBeenCalledWith(
      { param: { id: "7" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
    expect(
      client.getQueryData<{ shareToken: string }>([
        "custom-tier-list",
        "saved",
        7,
      ])?.shareToken,
    ).toBe("tok-1");
  });
});

describe("useDeleteCustomTierList", () => {
  it("削除して detail キャッシュを消し、一覧を無効化する", async () => {
    mockDelete.mockResolvedValue(okResponse({ ok: true }));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(["custom-tier-list", "saved", 7], SAVED);
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useDeleteCustomTierList(), {
      wrapper,
    });
    result.current.mutate(7);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      client.getQueryData(["custom-tier-list", "saved", 7]),
    ).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["custom-tier-list", "list"],
    });
  });
});
