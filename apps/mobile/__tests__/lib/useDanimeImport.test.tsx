// useDanimeMatch のチャンク分割テスト。
// issue #219: works 上限を超える入力は API 側の CPU/サブリクエスト上限に
// 達して 503 になるため、クライアントは上限単位で分割して逐次送信する。
// このテストは分割サイズが API スキーマの上限（100）を超えないことを保証する。
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDanimeMatch } from "@/lib/danime/useDanimeImport";
import { DANIME_EXTRACT_SCHEMA_VERSION } from "@animeishi/danime-core";
import type {
  DanimeExtractedLists,
  DanimeMatchItem,
} from "@animeishi/danime-core";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../../__mocks__/@clerk/clerk-expo";

const mockMatchPost = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      import: {
        danime: {
          match: { $post: (...args: unknown[]) => mockMatchPost(...args) },
        },
      },
    },
  },
}));

jest.mock("@/lib/annict", () => ({
  buildAnnictAuthHeader: async () => ({ "X-Annict-Token": "annict_tok" }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function listsOf(count: number): DanimeExtractedLists {
  return {
    schemaVersion: DANIME_EXTRACT_SCHEMA_VERSION,
    completed: [],
    history: Array.from({ length: count }, (_, i) => ({
      workId: `w${i}`,
      title: `作品${i}`,
      partIds: [`p${i}`],
    })),
  };
}

function okResponse(works: { danimeWorkId: string }[]) {
  const results: DanimeMatchItem[] = works.map((w) => ({
    danimeWorkId: w.danimeWorkId,
    title: "作品",
    targetState: "WATCHING",
    status: "none",
    work: null,
    candidates: [],
  }));
  return {
    ok: true,
    json: async () => ({
      results,
      stats: {
        firstPassSearches: 1,
        secondPassSearches: 0,
        retries: 0,
        elapsedMs: 1,
      },
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  loggedInUser({ userId: "user_me" });
  setMockClerkState({ getToken: async () => "clerk_jwt" });
});

describe("useDanimeMatch", () => {
  it("works を API 上限（100）ごとに分割して逐次送信し、結果を結合する", async () => {
    mockMatchPost.mockImplementation(async ({ json }) =>
      okResponse(json.works),
    );
    const { result } = renderHook(() => useDanimeMatch(), { wrapper });
    await act(async () => {
      result.current.mutate({ lists: listsOf(250) });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 250 件 → 100 + 100 + 50 の 3 リクエスト
    expect(mockMatchPost).toHaveBeenCalledTimes(3);
    const sentSizes = mockMatchPost.mock.calls.map(
      ([arg]) => (arg as { json: { works: unknown[] } }).json.works.length,
    );
    expect(sentSizes).toEqual([100, 100, 50]);
    // どのリクエストも API スキーマの上限を超えない
    for (const size of sentSizes) {
      expect(size).toBeLessThanOrEqual(100);
    }
    // 全件分の結果が順序維持で結合される
    const out = result.current.data;
    expect(out?.items).toHaveLength(250);
    expect(out?.items[0]?.danimeWorkId).toBe("w0");
    expect(out?.items[249]?.danimeWorkId).toBe("w249");
    // stats はチャンク間で合算される
    expect(out?.stats?.firstPassSearches).toBe(3);
  });
});
