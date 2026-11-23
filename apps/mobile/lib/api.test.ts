import { apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../__mocks__/@clerk/expo";

// 共通 fetch（apiFetch、issue #726）の振る舞いを検証する。
// - Clerk セッショントークンの Authorization 付与（getClerkInstance 経由。
//   @clerk/expo は moduleNameMapper で __mocks__ に解決される）
// - annict オプトイン時の X-Annict-Token 付与（buildAnnictAuthHeader の結果をそのまま載せる）
// - !res.ok（401 含む）を ApiRequestError に変換し、code を応答 JSON から読む
// - セッション切れでトークンが取れないときは ApiRequestError ではなく plain の
//   Error にする（observability の 4xx ドロップ対象にしないため）

const mockBuildAnnictAuthHeader = jest.fn();
jest.mock("@/lib/annict/buildAnnictAuthHeader", () => ({
  buildAnnictAuthHeader: () => mockBuildAnnictAuthHeader(),
}));

const mockFetch = jest.fn();

function okResponse(body: unknown = {}) {
  return { ok: true, status: 200, json: async () => body };
}

function errorResponse(status: number, body: unknown = {}) {
  return { ok: false, status, json: async () => body };
}

// apiFetch が組み立てた Headers を可読な形で取り出す。
function sentHeaders(): Record<string, string> {
  const init = mockFetch.mock.calls[0][1] as { headers: Headers };
  return Object.fromEntries(init.headers.entries());
}

beforeEach(() => {
  resetAuth();
  jest.clearAllMocks();
  globalThis.fetch = mockFetch;
  mockBuildAnnictAuthHeader.mockResolvedValue({});
});

describe("apiFetch", () => {
  it("サインイン済みなら Clerk セッショントークンを Authorization に付ける", async () => {
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockFetch.mockResolvedValue(okResponse());

    const res = await apiFetch({ errorMessage: "作品の取得に失敗しました" })(
      "https://api.example.com/works",
    );

    expect(res.ok).toBe(true);
    expect(sentHeaders().authorization).toBe("Bearer clerk_jwt");
  });

  it("annict: true のとき X-Annict-Token を付ける", async () => {
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockBuildAnnictAuthHeader.mockResolvedValue({
      "X-Annict-Token": "annict_tok",
    });
    mockFetch.mockResolvedValue(okResponse());

    await apiFetch({
      annict: true,
      errorMessage: "作品の取得に失敗しました",
    })("https://api.example.com/works");

    expect(sentHeaders()["x-annict-token"]).toBe("annict_tok");
  });

  it("annict を指定しないとき X-Annict-Token を付けない", async () => {
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockFetch.mockResolvedValue(okResponse());

    await apiFetch({ errorMessage: "作品の取得に失敗しました" })(
      "https://api.example.com/works",
    );

    // 未指定のときは buildAnnictAuthHeader 自体を呼ばない
    // （サーバーがヘッダの有無で挙動を分岐するため）。
    expect(mockBuildAnnictAuthHeader).not.toHaveBeenCalled();
    expect(sentHeaders()["x-annict-token"]).toBeUndefined();
  });

  it("呼び出し側が渡したヘッダを保持しつつ Authorization を上書きする", async () => {
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockFetch.mockResolvedValue(okResponse());

    await apiFetch({ errorMessage: "作品の取得に失敗しました" })(
      "https://api.example.com/works",
      {
        headers: {
          Authorization: "Bearer stale",
          "Content-Type": "application/json",
        },
      },
    );

    expect(sentHeaders()["content-type"]).toBe("application/json");
    expect(sentHeaders().authorization).toBe("Bearer clerk_jwt");
  });

  it("トークンが取れないときは ApiRequestError ではなく plain の Error を投げる", async () => {
    loggedInUser();
    // セッションがあっても getToken が null を返す（失効直後など）ケース。
    setMockClerkState({ getToken: async () => null });

    const error = await apiFetch({
      errorMessage: "作品の取得に失敗しました",
    })("https://api.example.com/works").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApiRequestError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("サインアウト中（セッション無し）も plain の Error を投げる", async () => {
    // resetAuth 直後は isSignedIn=false で getClerkInstance の session が null。
    const error = await apiFetch({
      errorMessage: "作品の取得に失敗しました",
    })("https://api.example.com/works").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApiRequestError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("!res.ok のとき status と errorMessage を持つ ApiRequestError を投げる", async () => {
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockFetch.mockResolvedValue(errorResponse(500));

    const error = await apiFetch({
      errorMessage: "評価の保存に失敗しました",
    })("https://api.example.com/me/work-ratings/42").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(500);
    // i18next 未初期化のテスト環境では t() がキーをそのまま返す。
    expect((error as ApiRequestError).message).toBe("評価の保存に失敗しました");
  });

  it("401 も他のステータスと同じく ApiRequestError に変換し code を読む", async () => {
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockFetch.mockResolvedValue(
      errorResponse(401, {
        error: "Annict 連携が必要です",
        code: "annict_token_required",
      }),
    );

    const error = await apiFetch({
      annict: true,
      errorMessage: "話の記録に失敗しました",
    })("https://api.example.com/me/episode-records/101").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(401);
    // annict_token_* の code は画面側の失効検知（isAnnictTokenError）に伝わる。
    expect((error as ApiRequestError).code).toBe("annict_token_required");
  });

  it("エラー応答が JSON でない / code を持たないとき code は undefined", async () => {
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockFetch.mockResolvedValue(errorResponse(502, { error: "Bad Gateway" }));

    const error = await apiFetch({
      errorMessage: "作品の検索に失敗しました",
    })("https://api.example.com/works/search").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBeUndefined();
  });
});
