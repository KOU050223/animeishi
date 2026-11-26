import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  getReportErrorMessage,
  useReportUser,
  useBlockUser,
} from "@/lib/useModeration";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { createTestQueryClient } from "@/test-utils/queryClient";
import { setMockClerkState } from "../../__mocks__/@clerk/expo";

const mockReportPost = jest.fn();
const mockBlockPost = jest.fn();
const mockApiFetch = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/api", () => ({
  apiClient: {
    users: {
      ":id": {
        report: { $post: (...args: unknown[]) => mockReportPost(...args) },
        block: { $post: (...args: unknown[]) => mockBlockPost(...args) },
      },
    },
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

function makeWrapper() {
  const client = createTestQueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = createTestQueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  loggedInUser({ userId: "user_me" });
  setMockClerkState({ getToken: async () => "clerk_jwt" });
});

describe("useReportUser", () => {
  async function runReport() {
    const { result } = await renderHook(() => useReportUser(), { wrapper });
    await act(async () => {
      result.current.mutate({ userId: "user_target", reason: "スパム・宣伝" });
    });
    // mutation が settle（成功 or 失敗）するまで待つ
    await waitFor(() =>
      expect(result.current.isError || result.current.isSuccess).toBe(true),
    );
    return result;
  }

  it("成功時はレスポンスを返す", async () => {
    mockReportPost.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true }),
    });
    const { result } = await renderHook(() => useReportUser(), { wrapper });
    await act(async () => {
      result.current.mutate({ userId: "user_target", reason: "スパム・宣伝" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockReportPost).toHaveBeenCalledWith(
      { param: { id: "user_target" }, json: { reason: "スパム・宣伝" } },
      // 認証ヘッダの組み立ては apiFetch に委譲したため fetch オプションのみ。
      { fetch: expect.any(Function) },
    );
  });

  // 429 / 失敗応答の文言変換は apiFetch の onHttpError が担うため、
  // 本番のコールバックを取り出して応答を与えて検証する。
  async function getReportHttpError() {
    mockReportPost.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true }),
    });
    await runReport();
    const options = mockApiFetch.mock.calls
      .map(
        (call) =>
          call[0] as { onHttpError?: (res: Response) => Promise<Error> },
      )
      .find((opts) => typeof opts.onHttpError === "function");
    expect(options).toBeDefined();
    return options!.onHttpError!;
  }

  it("429 のときサーバーの error ではなく code から表示文言を引く", async () => {
    const onHttpError = await getReportHttpError();
    const err = (await onHttpError(
      new Response(
        JSON.stringify({
          // error は開発者向け英語（issue #838）。画面には出さない。
          error: "Duplicate report target",
          code: "duplicate_target",
        }),
        { status: 429 },
      ),
    )) as ApiRequestError;
    expect(err.status).toBe(429);
    expect(err.message).toBe("同じユーザーへの通報は24時間に1回までです");
    expect(err.code).toBe("duplicate_target");
  });

  it("429 で body が読めないときは既定の上限メッセージ", async () => {
    const onHttpError = await getReportHttpError();
    const err = (await onHttpError(
      new Response("invalid json", { status: 429 }),
    )) as ApiRequestError;
    expect(err.message).toBe("通報の送信回数が上限に達しました");
  });

  it("429 以外の失敗は従来どおりの固定メッセージ", async () => {
    const onHttpError = await getReportHttpError();
    const err = (await onHttpError(
      new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
      }),
    )) as ApiRequestError;
    expect(err.status).toBe(404);
    expect(err.message).toBe("通報に失敗しました");
  });
});

describe("getReportErrorMessage", () => {
  it("429 の理由を既知の翻訳キーへ対応させる", () => {
    expect(
      getReportErrorMessage(
        new ApiRequestError(429, "reason", "duplicate_target"),
      ),
    ).toBe("同じユーザーへの通報は24時間に1回までです");
    expect(
      getReportErrorMessage(new ApiRequestError(429, "reason", "hourly_limit")),
    ).toBe(
      "通報の送信回数が上限に達しました。しばらくしてから再度お試しください",
    );
    // edge のユーザー単位流量制限（issue #715）
    expect(
      getReportErrorMessage(new ApiRequestError(429, "reason", "rate_limited")),
    ).toBe("リクエストが多すぎます。しばらくしてからお試しください");
  });

  it("未知のエラーは汎用文言にする", () => {
    expect(getReportErrorMessage(new Error("unknown"))).toBe(
      "通報に失敗しました",
    );
  });
});

describe("useBlockUser", () => {
  it("ブロック成功で公開作品リストのクエリも invalidate される", async () => {
    mockBlockPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    const { client, wrapper: clientWrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useBlockUser(), {
      wrapper: clientWrapper,
    });
    await act(async () => {
      result.current.mutate("user_target");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["work-list", "public"],
    });
  });
});
