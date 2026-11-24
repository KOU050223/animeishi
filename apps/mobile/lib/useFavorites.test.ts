import React from "react";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  nextFavoriteAction,
  matchesFavoriteQuery,
  useAddFavorite,
  useRemoveFavorite,
} from "@/lib/useFavorites";
import { useCommonPoints } from "@/lib/useCommonPoints";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../__mocks__/@clerk/expo";

let mockFavoriteMatchCount = 0;
const mockApiFetch = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      favorites: {
        ":annictWorkId": {
          $post: async () => {
            mockFavoriteMatchCount = 1;
            return { ok: true, json: async () => ({}) };
          },
          $delete: async () => {
            mockFavoriteMatchCount = 0;
            return { ok: true, headers: { get: () => "" } };
          },
        },
      },
    },
    users: {
      ":id": {
        common: {
          $get: async () => ({
            ok: true,
            json: async () => ({
              watchingTogether: [],
              watchedTogetherCount: 0,
              favoriteTogether: mockFavoriteMatchCount
                ? [
                    {
                      annictWorkId: 1,
                      title: "共通の推し",
                      hostedImageUrl: null,
                    },
                  ]
                : [],
              conversationStarters: [],
            }),
          }),
        },
      },
    },
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  clerkSessionToken: async () => "clerk_jwt",
}));
jest.mock("@/lib/annict", () => ({ buildAnnictAuthHeader: async () => ({}) }));

describe("matchesFavoriteQuery", () => {
  const favorite = {
    title: "Re:ゼロから始める異世界生活",
    titleKana: "リゼロカラハジメルイセカイセイカツ",
    titleEn: "Re:Zero − Starting Life in Another World",
  };

  it("title の部分一致でマッチする", () => {
    expect(matchesFavoriteQuery(favorite, "異世界")).toBe(true);
  });

  it("title に含まれる英字部分は大文字小文字を無視してマッチする", () => {
    expect(matchesFavoriteQuery(favorite, "re:ゼロ")).toBe(true);
  });

  it("titleEn の大文字小文字を無視してマッチする", () => {
    expect(matchesFavoriteQuery(favorite, "starting life")).toBe(true);
  });

  it("ひらがな入力でも titleKana(カタカナ) にマッチする", () => {
    expect(matchesFavoriteQuery(favorite, "りぜろ")).toBe(true);
  });

  it("どのフィールドにも一致しなければ false", () => {
    expect(matchesFavoriteQuery(favorite, "ワンピース")).toBe(false);
  });

  it("空文字クエリは true を返す", () => {
    expect(matchesFavoriteQuery(favorite, "")).toBe(true);
  });
});

describe("nextFavoriteAction", () => {
  it("未登録の animeId は add を返す", () => {
    const favoriteIds = new Set<number>([1, 2, 3]);
    expect(nextFavoriteAction(favoriteIds, 99)).toBe("add");
  });

  it("登録済みの animeId は remove を返す", () => {
    const favoriteIds = new Set<number>([1, 2, 3]);
    expect(nextFavoriteAction(favoriteIds, 2)).toBe("remove");
  });

  it("空の Set ではどの animeId も add を返す", () => {
    const favoriteIds = new Set<number>();
    expect(nextFavoriteAction(favoriteIds, 1)).toBe("add");
  });
});

describe("推しを変更した後の共通点", () => {
  let client: QueryClient;
  beforeEach(async () => {
    resetAuth();
    loggedInUser({ userId: "user_me" });
    setMockClerkState({ getToken: async () => "test-token" });
    mockFavoriteMatchCount = 0;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => {
    await cleanup();
    client
      .getMutationCache()
      .getAll()
      .forEach((mutation) => mutation.destroy());
    client.clear();
  });

  it("推しの追加と解除後、開いているフレンドの共通点を再取得する", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);
    const { result } = await renderHook(
      () => ({
        common: useCommonPoints("user_friend"),
        add: useAddFavorite(),
        remove: useRemoveFavorite(),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.common.data?.favoriteTogether).toHaveLength(0),
    );
    await act(async () => {
      await result.current.add.mutateAsync(1);
    });
    await waitFor(() =>
      expect(result.current.common.data?.favoriteTogether).toHaveLength(1),
    );
    await act(async () => {
      await result.current.remove.mutateAsync(1);
    });
    await waitFor(() =>
      expect(result.current.common.data?.favoriteTogether).toHaveLength(0),
    );
  });
});
