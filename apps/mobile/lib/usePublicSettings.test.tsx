import { act } from "react";
import { renderHook } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePublicSettings } from "@/lib/usePublicSettings";
import { PROFILE_QUERY_KEY } from "@/lib/useProfile";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser } from "@/test-utils/auth";
import { setMockClerkState } from "../__mocks__/@clerk/expo";

// PUT /me/profile/visibility（is_public だけを更新する専用エンドポイント）への
// リクエストが正しく組み立てられるかだけを確認する。
const mockVisibilityPut = jest.fn();
const mockApiFetch = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      profile: {
        // jest.mock ファクトリは定数の初期化前に評価されるため、
        // 呼び出し時に参照する形にしておく。
        visibility: {
          $put: (...args: unknown[]) => mockVisibilityPut(...args),
        },
      },
    },
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// useProfile（GET /me/profile の取得側）だけ差し替える
const mockUseProfile = jest.fn(
  (): { data?: { username: string; isPublic: boolean } } => ({
    data: { username: "testuser", isPublic: true },
  }),
);
jest.mock("@/lib/useProfile", () => ({
  useProfile: () => mockUseProfile(),
  PROFILE_QUERY_KEY: ["profile"],
}));

function createWrapper(client = new QueryClient()) {
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const getToken = jest.fn(async () => "token_test");

beforeEach(() => {
  mockVisibilityPut.mockReset();
  mockVisibilityPut.mockResolvedValue({ ok: true, status: 200 });
  mockUseProfile.mockReturnValue({
    data: { username: "testuser", isPublic: true },
  });
  loggedInUser({ userId: "user_test" });
  setMockClerkState({ getToken });
});

describe("usePublicSettings", () => {
  it("プロフィールが公開のとき profileVisibility は public を返す", async () => {
    const q = await renderHook(() => usePublicSettings(), {
      wrapper: createWrapper(),
    });
    expect(q.result.current.profileVisibility).toBe("public");
  });

  it("プロフィールが非公開のとき profileVisibility は private を返す", async () => {
    mockUseProfile.mockReturnValue({
      data: { username: "testuser", isPublic: false },
    });
    const q = await renderHook(() => usePublicSettings(), {
      wrapper: createWrapper(),
    });
    expect(q.result.current.profileVisibility).toBe("private");
  });

  it("未取得のときは公開扱いにする", async () => {
    mockUseProfile.mockReturnValue({ data: undefined });
    const q = await renderHook(() => usePublicSettings(), {
      wrapper: createWrapper(),
    });
    expect(q.result.current.profileVisibility).toBe("public");
  });

  it("public への切り替えは isPublic: true だけを送る", async () => {
    const q = await renderHook(() => usePublicSettings(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await q.result.current.toggle("profile", "public");
    });
    // 認証ヘッダの組み立ては apiFetch に委譲されたため、呼び出し側は
    // fetch オプションを渡すだけになる。
    expect(mockVisibilityPut).toHaveBeenCalledWith(
      { json: { isPublic: true } },
      { fetch: expect.any(Function) },
    );
  });

  it("private への切り替えは isPublic: false だけを送る", async () => {
    const q = await renderHook(() => usePublicSettings(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await q.result.current.toggle("profile", "private");
    });
    expect(mockVisibilityPut).toHaveBeenCalledWith(
      { json: { isPublic: false } },
      { fetch: expect.any(Function) },
    );
  });

  it("保存に成功するとプロフィールの取得クエリを無効化する", async () => {
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const q = await renderHook(() => usePublicSettings(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await act(async () => {
      await q.result.current.toggle("profile", "private");
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: PROFILE_QUERY_KEY,
    });
  });

  it("更新が失敗したときエラーを投げる", async () => {
    // 実際のエラー変換は apiFetch 側で行われるため、apiClient の
    // モックは変換後の ApiRequestError を reject する。
    mockVisibilityPut.mockRejectedValue(
      new ApiRequestError(500, "公開設定の更新に失敗しました"),
    );
    const q = await renderHook(() => usePublicSettings(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await expect(
        q.result.current.toggle("profile", "private"),
      ).rejects.toThrow("公開設定の更新に失敗しました");
    });
    expect(q.result.current.pendingKey).toBeNull();
  });

  it("保存中は pendingKey にキーが入り、連打しても再送しない", async () => {
    let release: (() => void) | undefined;
    mockVisibilityPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, status: 200 });
        }),
    );
    const q = await renderHook(() => usePublicSettings(), {
      wrapper: createWrapper(),
    });

    let first: Promise<void> | undefined;
    await act(async () => {
      first = q.result.current.toggle("profile", "private");
    });
    expect(q.result.current.pendingKey).toBe("profile");

    await act(async () => {
      await q.result.current.toggle("profile", "public");
    });
    expect(mockVisibilityPut).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await first;
    });
    expect(q.result.current.pendingKey).toBeNull();
  });
});
