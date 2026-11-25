import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { applyApiErrorHandling } from "../../test-utils/apiApp";

const clerkMock = vi.hoisted(() => ({
  getUserList: vi.fn(),
  verifyPassword: vi.fn(),
  createSignInToken: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    users: {
      getUserList: clerkMock.getUserList,
      verifyPassword: clerkMock.verifyPassword,
    },
    signInTokens: { createSignInToken: clerkMock.createSignInToken },
  }),
}));

vi.mock("@clerk/backend/errors", () => ({
  isClerkAPIResponseError: (e: unknown) =>
    typeof e === "object" && e !== null && "clerkError" in e,
}));

import { demoSignIn, REVIEW_DEMO_ACCOUNT_ROLE } from "@/features/demo-sign-in";

const DEMO_EMAIL = "review@example.com";

function limiter(success = true) {
  return { limit: vi.fn(async () => ({ success })) };
}

function buildApp() {
  const app = applyApiErrorHandling(new Hono());
  app.route("/auth", demoSignIn);
  return app;
}

function postDemoSignIn(
  body: unknown,
  rateLimiter: ReturnType<typeof limiter> | undefined = limiter(),
) {
  return buildApp().request(
    "/auth/demo-sign-in",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.1",
      },
      body: JSON.stringify(body),
    },
    { CLERK_SECRET_KEY: "sk_test", DEMO_SIGN_IN_RATE_LIMITER: rateLimiter },
  );
}

function clerkUser(demoAccount?: string) {
  return {
    id: "user_demo",
    publicMetadata: demoAccount ? { demoAccount } : {},
  };
}

describe("POST /auth/demo-sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerkMock.getUserList.mockResolvedValue({
      data: [clerkUser(REVIEW_DEMO_ACCOUNT_ROLE)],
    });
    clerkMock.verifyPassword.mockResolvedValue({ verified: true });
    clerkMock.createSignInToken.mockResolvedValue({ token: "ticket_abc" });
  });

  it("デモアカウントでパスワードが合えば sign-in token を返す", async () => {
    const res = await postDemoSignIn({ email: DEMO_EMAIL, password: "pw" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticket: "ticket_abc" });
    expect(clerkMock.verifyPassword).toHaveBeenCalledWith({
      userId: "user_demo",
      password: "pw",
    });
    expect(clerkMock.createSignInToken).toHaveBeenCalledWith({
      userId: "user_demo",
      expiresInSeconds: 60,
    });
  });

  it("デモアカウント以外はパスワードを照合せず 401 を返す", async () => {
    clerkMock.getUserList.mockResolvedValue({ data: [clerkUser()] });

    const res = await postDemoSignIn({ email: DEMO_EMAIL, password: "pw" });

    expect(res.status).toBe(401);
    expect(clerkMock.verifyPassword).not.toHaveBeenCalled();
    expect(clerkMock.createSignInToken).not.toHaveBeenCalled();
  });

  it("フレンド役のデモアカウントはログインさせない", async () => {
    clerkMock.getUserList.mockResolvedValue({ data: [clerkUser("friend")] });

    const res = await postDemoSignIn({ email: DEMO_EMAIL, password: "pw" });

    expect(res.status).toBe(401);
  });

  it("存在しないアカウントは 401 を返す", async () => {
    clerkMock.getUserList.mockResolvedValue({ data: [] });

    const res = await postDemoSignIn({ email: DEMO_EMAIL, password: "pw" });

    expect(res.status).toBe(401);
  });

  it("パスワードが違えば 401 を返し token を発行しない", async () => {
    clerkMock.verifyPassword.mockRejectedValue({
      clerkError: true,
      status: 422,
    });

    const res = await postDemoSignIn({ email: DEMO_EMAIL, password: "wrong" });

    expect(res.status).toBe(401);
    expect(clerkMock.createSignInToken).not.toHaveBeenCalled();
  });

  it("試行回数の上限を超えたら Clerk に問い合わせず 429 を返す", async () => {
    const res = await postDemoSignIn(
      { email: DEMO_EMAIL, password: "pw" },
      limiter(false),
    );

    expect(res.status).toBe(429);
    expect(clerkMock.getUserList).not.toHaveBeenCalled();
  });

  it("IP とメールアドレスの両方で試行回数を数える", async () => {
    const rateLimiter = limiter();

    await postDemoSignIn(
      { email: "Review@Example.com", password: "pw" },
      rateLimiter,
    );

    expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "ip:203.0.113.1" });
    expect(rateLimiter.limit).toHaveBeenCalledWith({
      key: "email:review@example.com",
    });
  });

  it("メールアドレスの形式が不正なら 400 を返す", async () => {
    const res = await postDemoSignIn({ email: "not-an-email", password: "pw" });

    expect(res.status).toBe(400);
    expect(clerkMock.getUserList).not.toHaveBeenCalled();
  });
});
