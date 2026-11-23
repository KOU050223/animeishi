import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "./test-utils/setup-db";

// requireAuth の本体（Clerk 検証と D1 照会）の実行回数を数える（issue #710）。
const counts = vi.hoisted(() => ({
  clerkMiddleware: 0,
  getMyDeletedAt: 0,
  ensureUserExists: 0,
}));

vi.mock("@clerk/hono", () => ({
  clerkMiddleware:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      counts.clerkMiddleware++;
      c.set("clerk", {
        users: { getUser: async () => ({ username: "counter" }) },
      });
      await next();
    },
  getAuth: () => ({ userId: USER_ID }),
}));

vi.mock("@/features/users/repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/users/repository")>();
  return {
    ...actual,
    usersRepository: (...args: Parameters<typeof actual.usersRepository>) => {
      const repo = actual.usersRepository(...args);
      return {
        ...repo,
        getMyDeletedAt: () => {
          counts.getMyDeletedAt++;
          return repo.getMyDeletedAt();
        },
        ensureUserExists: (...a: Parameters<typeof repo.ensureUserExists>) => {
          counts.ensureUserExists++;
          return repo.ensureUserExists(...a);
        },
      };
    },
  };
});

vi.mock("@sentry/cloudflare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/cloudflare")>();
  return {
    ...actual,
    // withSentry は素通しにして default export の fetch を直接呼べるようにする。
    withSentry: vi.fn((_options: unknown, handler: unknown) => handler),
    captureException: vi.fn(),
  };
});

import handler from "@/index";

const USER_ID = "user_authcount01";

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function request(path: string) {
  return handler.fetch(
    new Request(`https://api.example.test${path}`, {
      headers: { Authorization: "Bearer test-token" },
    }),
    {
      DB: env.DB,
      AVATARS: env.AVATARS,
      CLERK_SECRET_KEY: "test_secret",
      CLERK_PUBLISHABLE_KEY: "test_pub",
    },
    ctx,
  );
}

describe("重ねてマウントしたサブアプリの requireAuth（issue #710）", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    counts.clerkMiddleware = 0;
    counts.getMyDeletedAt = 0;
    counts.ensureUserExists = 0;
  });

  it.each(["/users/public", "/me/friends", "/works/1", "/works/1/episodes"])(
    "%s では Clerk 検証と D1 照会が 1 回だけ走る",
    async (path) => {
      await request(path);

      expect(counts).toEqual({
        clerkMiddleware: 1,
        getMyDeletedAt: 1,
        ensureUserExists: 1,
      });
    },
  );
});
