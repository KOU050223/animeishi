import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils/queryClient";
import { useWorksLookup } from "./useWorksLookup";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, signedOutUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "@/__mocks__/@clerk/expo";

// apiClient の /works/lookup 呼び出しをモックし、ID まとめ解決の
// バッチ分割（50 件上限）と結果の連結順を検証する。
const mockLookupGet = jest.fn();
// 認証ヘッダ・Annict ヘッダの付与は共通 fetch（apiFetch）側の責務になったため、
// ここでは apiFetch が適切なオプションで呼ばれたことだけを見る
// （ヘッダ実装の検証は lib/api.test.ts）。
const mockApiFetch = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/api", () => ({
  apiClient: {
    works: { lookup: { $get: (...args: unknown[]) => mockLookupGet(...args) } },
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

let mockCanBrowseWorks = true;
jest.mock("@/lib/annict", () => ({
  // 本人は未連携のまま（共用トークンで作品情報だけ使える状態）を既定にして、
  // 取得条件が連携状態ではなく canBrowseWorks で決まることを確かめる（issue #561）。
  useWorkCatalogAccess: () => ({
    canBrowseWorks: mockCanBrowseWorks,
    isConnected: false,
    isLoading: false,
  }),
}));

function makeWrapper(
  client = createTestQueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  }),
) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function okResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

function workOf(id: number) {
  return { annictWorkId: id, title: `作品${id}` };
}

describe("useWorksLookup", () => {
  beforeEach(async () => {
    resetAuth();
    mockLookupGet.mockReset();
    mockApiFetch.mockReset();
    mockCanBrowseWorks = true;
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockLookupGet.mockImplementation((arg: { query: { ids: string } }) =>
      Promise.resolve(
        okResponse({
          works: arg.query.ids.split(",").map((id) => workOf(Number(id))),
        }),
      ),
    );
  });

  it("ids が空の間はフェッチしない", async () => {
    await renderHook(() => useWorksLookup([]), { wrapper: makeWrapper() });
    expect(mockLookupGet).not.toHaveBeenCalled();
  });

  it("ids を /works/lookup に渡し、works を ID 順で返す", async () => {
    const { result } = await renderHook(() => useWorksLookup([3, 1, 2]), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data?.works).toHaveLength(3));
    expect(mockLookupGet).toHaveBeenCalledTimes(1);
    const [arg] = mockLookupGet.mock.calls[0];
    expect(arg.query).toEqual({ ids: "3,1,2" });
    // Annict トークン付きの共通 fetch で呼んでいる。
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.objectContaining({ annict: true }),
    );
    expect(result.current.data?.works.map((w) => w.annictWorkId)).toEqual([
      3, 1, 2,
    ]);
  });

  it("51 件以上の ids は 50 件ずつのバッチに分けて取得し、元の並びで連結する", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const { result } = await renderHook(() => useWorksLookup(ids), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data?.works).toHaveLength(120));
    expect(mockLookupGet).toHaveBeenCalledTimes(3);
    const batchSizes = mockLookupGet.mock.calls.map(
      ([arg]) => arg.query.ids.split(",").length,
    );
    expect(batchSizes).toEqual([50, 50, 20]);
    expect(result.current.data?.works.map((w) => w.annictWorkId)).toEqual(ids);
  });

  it("入力 ids や応答に同じ id が重複しても works は 1 件に畳む（issue #521）", async () => {
    const { result } = await renderHook(() => useWorksLookup([1, 2, 1]), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data?.works).toHaveLength(2));
    expect(result.current.data?.works.map((w) => w.annictWorkId)).toEqual([
      1, 2,
    ]);
  });

  it("途中のバッチが失敗したらエラーになる", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    mockLookupGet
      .mockImplementationOnce((arg: { query: { ids: string } }) =>
        Promise.resolve(
          okResponse({
            works: arg.query.ids.split(",").map((id) => workOf(Number(id))),
          }),
        ),
      )
      // 失敗応答は共通 fetch（apiFetch）が ApiRequestError に変換して
      // $get を reject させるため、モック側も reject で表現する。
      .mockRejectedValueOnce(
        new ApiRequestError(400, "作品の取得に失敗しました"),
      );

    const { result } = await renderHook(() => useWorksLookup(ids), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("作品情報を使えない（未連携かつ共用トークン無し）うちはフェッチしない", async () => {
    mockCanBrowseWorks = false;
    await renderHook(() => useWorksLookup([1]), { wrapper: makeWrapper() });
    expect(mockLookupGet).not.toHaveBeenCalled();
  });

  it("サインアウト中はフェッチしない", async () => {
    signedOutUser();
    await renderHook(() => useWorksLookup([1]), { wrapper: makeWrapper() });
    expect(mockLookupGet).not.toHaveBeenCalled();
  });
});
