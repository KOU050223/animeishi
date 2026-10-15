import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useReportUser } from "@/lib/useModeration";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../../__mocks__/@clerk/clerk-expo";

const mockReportPost = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    users: {
      ":id": {
        report: { $post: (...args: unknown[]) => mockReportPost(...args) },
      },
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  loggedInUser({ userId: "user_me" });
  setMockClerkState({ getToken: async () => "clerk_jwt" });
});

describe("useReportUser", () => {
  async function runReport() {
    const { result } = renderHook(() => useReportUser(), { wrapper });
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
    const { result } = renderHook(() => useReportUser(), { wrapper });
    await act(async () => {
      result.current.mutate({ userId: "user_target", reason: "スパム・宣伝" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockReportPost).toHaveBeenCalledWith(
      { param: { id: "user_target" }, json: { reason: "スパム・宣伝" } },
      { headers: { Authorization: "Bearer clerk_jwt" } },
    );
  });

  it("429 のときサーバーの error メッセージをそのままエラーにする", async () => {
    mockReportPost.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: "同じユーザーへの通報は24時間に1回までです",
        code: "duplicate_target",
      }),
    });
    const result = await runReport();
    const err = result.current.error as ApiRequestError;
    expect(err.status).toBe(429);
    expect(err.message).toBe("同じユーザーへの通報は24時間に1回までです");
  });

  it("429 で body が読めないときは既定の上限メッセージ", async () => {
    mockReportPost.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => {
        throw new Error("invalid json");
      },
    });
    const result = await runReport();
    const err = result.current.error as ApiRequestError;
    expect(err.message).toBe("通報の送信回数が上限に達しました");
  });

  it("429 以外の失敗は従来どおりの固定メッセージ", async () => {
    mockReportPost.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "User not found" }),
    });
    const result = await runReport();
    const err = result.current.error as ApiRequestError;
    expect(err.status).toBe(404);
    expect(err.message).toBe("通報に失敗しました");
  });
});
