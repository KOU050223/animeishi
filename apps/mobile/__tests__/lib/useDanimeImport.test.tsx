// useDanimeMatch のチャンク分割テスト。
// issue #219: 大量の works を 1 リクエストで照合すると API 側の CPU 時間上限に
// 達して 503 になるため、クライアントは 100 件単位で分割して逐次送信する。
// このテストは分割・逐次送信・結果の結合が正しく行われることを保証する。
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDanimeMatch } from "@/lib/danime/useDanimeImport";
import { ApiRequestError } from "@/lib/apiError";
import { DANIME_EXTRACT_SCHEMA_VERSION } from "@animeishi/danime-core";
import type {
  DanimeAnnictWork,
  DanimeExtractedLists,
  DanimeMatchItem,
} from "@animeishi/danime-core";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../../__mocks__/@clerk/expo";

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

function okResponse(works: { danimeWorkId: string; title: string }[]) {
  const results: DanimeMatchItem[] = works.map((w) => ({
    danimeWorkId: w.danimeWorkId,
    title: w.title,
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

function annictWork(annictWorkId: number, title?: string): DanimeAnnictWork {
  return {
    annictWorkId,
    nodeId: `Work-${annictWorkId}`,
    title: title ?? `Annict作品${annictWorkId}`,
    titleKana: null,
    titleEn: null,
    seasonName: null,
    seasonYear: null,
    imageUrl: null,
    malAnimeId: null,
  };
}

// 全件を exact で返すレスポンス。確定作品は workFor で作品ごとに指定できる
// （省略時は danimeWorkId の番号で一意な作品）。
function exactResponse(
  works: { danimeWorkId: string; title: string }[],
  workFor: (danimeWorkId: string) => DanimeAnnictWork = (id) =>
    annictWork(Number(id.slice(1))),
) {
  const results: DanimeMatchItem[] = works.map((w) => ({
    danimeWorkId: w.danimeWorkId,
    title: w.title,
    targetState: "WATCHING",
    status: "exact",
    work: workFor(w.danimeWorkId),
    candidates: [],
  }));
  return {
    ok: true,
    json: async () => ({ results }),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  loggedInUser({ userId: "user_me" });
  setMockClerkState({ getToken: async () => "clerk_jwt" });
});

describe("useDanimeMatch", () => {
  it("works を 100 件ごとに分割して逐次送信し、結果を結合する", async () => {
    mockMatchPost.mockImplementation(async ({ json }) =>
      okResponse(json.works),
    );
    const { result } = await renderHook(() => useDanimeMatch(), { wrapper });
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
    // どのリクエストも分割サイズ（100）を超えない
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

  // issue #219: チャンク分割により API が検出できなくなる「正規化タイトルが
  // 同じ別の Annict 作品が別チャンクで exact 確定する」曖昧さを、結合後に
  // クライアント側で解消する（同一リクエスト内なら API が行う
  // 「同名複数 exact 候補 → candidates」の判定と揃える）。
  it("チャンク越しで正規化タイトルが同じ別作品が exact 確定したら candidates に降格する", async () => {
    // w0（チャンク1）→ id 0「テスト作品」、w100（チャンク2）→ id 100
    // 「テスト・作品」（中黒の表記揺れで正規化後は同一）。別 annictWorkId
    const lists = listsOf(150);
    mockMatchPost.mockImplementation(async ({ json }) =>
      exactResponse(json.works, (id) =>
        id === "w0"
          ? annictWork(0, "テスト作品")
          : id === "w100"
            ? annictWork(100, "テスト・作品")
            : annictWork(Number(id.slice(1))),
      ),
    );
    const { result } = await renderHook(() => useDanimeMatch(), { wrapper });
    await act(async () => {
      result.current.mutate({ lists });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const out = result.current.data;
    expect(out?.items).toHaveLength(150);
    const first = out?.items[0];
    const second = out?.items[100];
    // 同名の別 Annict 作品（id 0 / 100）に確定 → 両方 candidates に降格し、
    // グループ内の全作品が candidates に入る
    expect(first?.status).toBe("candidates");
    expect(first?.work).toBeNull();
    expect(first?.candidates.map((c) => c.annictWorkId)).toEqual([0, 100]);
    expect(second?.status).toBe("candidates");
    expect(second?.work).toBeNull();
    expect(second?.candidates.map((c) => c.annictWorkId)).toEqual([0, 100]);
    // タイトルが一意な他作品は exact のまま
    expect(out?.items[1]?.status).toBe("exact");
  });

  // issue #219: 画面には code ごとのユーザー文言を出すため、API の
  // エラー JSON（{error, code}）の code だけ ApiRequestError に残す。
  it("API エラー JSON の code を ApiRequestError に載せ、本文はメッセージに含めない", async () => {
    mockMatchPost.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () =>
        JSON.stringify({
          error: "Annict との通信に失敗しました",
          code: "annict_upstream",
        }),
    });
    const { result } = await renderHook(() => useDanimeMatch(), { wrapper });
    await act(async () => {
      result.current.mutate({ lists: listsOf(1) });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const error = result.current.error;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(502);
    expect((error as ApiRequestError).code).toBe("annict_upstream");
    expect(error?.message).not.toContain("annict_upstream");
  });

  it("チャンク越しで同じ annictWorkId に確定した場合は exact のまま", async () => {
    const lists = listsOf(150);
    // 両方とも同じ Annict 作品に確定したケース（dアニメ側の重複登録など）
    mockMatchPost.mockImplementation(async ({ json }) =>
      exactResponse(json.works, () => annictWork(999)),
    );
    const { result } = await renderHook(() => useDanimeMatch(), { wrapper });
    await act(async () => {
      result.current.mutate({ lists });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.items[0]?.status).toBe("exact");
    expect(result.current.data?.items[100]?.status).toBe("exact");
  });
});
