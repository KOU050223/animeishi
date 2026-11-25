import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./test-utils/setup-db";
import { applyApiErrorHandling } from "./test-utils/apiApp";
import { requireAuth } from "#src/middleware/auth";
import { users } from "#src/db/schema";

// requireAuth の本体（Clerk 検証と D1 照会）の実行回数を数える（issue #710, #711）。
const counts = vi.hoisted(() => ({
  clerkMiddleware: 0,
  getMyAuthState: 0,
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

vi.mock("#src/features/users/repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#src/features/users/repository")>();
  return {
    ...actual,
    usersRepository: (...args: Parameters<typeof actual.usersRepository>) => {
      const repo = actual.usersRepository(...args);
      return {
        ...repo,
        getMyAuthState: () => {
          counts.getMyAuthState++;
          return repo.getMyAuthState();
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

import handler from "#src/index";

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
    counts.getMyAuthState = 0;
    counts.ensureUserExists = 0;
  });

  it.each(["/users/public", "/me/friends", "/works/1", "/works/1/episodes"])(
    "%s では Clerk 検証と D1 照会が 1 回だけ走る",
    async (path) => {
      await request(path);

      expect(counts).toEqual({
        clerkMiddleware: 1,
        getMyAuthState: 1,
        ensureUserExists: 1,
      });
    },
  );
});

describe("requireAuth の D1 往復回数（issue #711）", () => {
  // D1Database を包んで、D1 への往復回数を数える。
  // prepare はローカルでステートメントを組み立てるだけなので往復に数えない。
  // db.batch は複数ステートメントを 1 回の呼び出しで送るため 1 往復として 1 と数える。
  function createCountingD1(d1: D1Database) {
    let roundtrips = 0;
    // drizzle は batch に session.prepare() で作った（= ここで wrap した）
    // ステートメントを渡してくるため、実ステートメントへ戻せるよう対応を持つ。
    const originals = new Map<D1PreparedStatement, D1PreparedStatement>();
    const wrapStatement = (stmt: D1PreparedStatement): D1PreparedStatement => {
      const wrapped = {
        bind: (...args: unknown[]) => wrapStatement(stmt.bind(...args)),
        first: async (colName?: string) => {
          roundtrips++;
          return colName === undefined ? stmt.first() : stmt.first(colName);
        },
        run: async () => {
          roundtrips++;
          return stmt.run();
        },
        all: async () => {
          roundtrips++;
          return stmt.all();
        },
        raw: async (options?: { columnNames?: boolean }) => {
          roundtrips++;
          return options?.columnNames
            ? stmt.raw({ columnNames: true })
            : stmt.raw();
        },
      } as D1PreparedStatement;
      originals.set(wrapped, stmt);
      return wrapped;
    };
    const db = {
      prepare: (query: string) => wrapStatement(d1.prepare(query)),
      batch: async (statements: D1PreparedStatement[]) => {
        roundtrips++;
        return d1.batch(statements.map((s) => originals.get(s) ?? s));
      },
      exec: async (query: string) => {
        roundtrips++;
        return d1.exec(query);
      },
      dump: () => d1.dump(),
      withSession: (constraintOrBookmark?: string) =>
        d1.withSession(constraintOrBookmark),
    } as unknown as D1Database;
    return { db, roundtrips: () => roundtrips };
  }

  type TestEnv = {
    Bindings: {
      DB: D1Database;
      CLERK_SECRET_KEY: string;
      CLERK_PUBLISHABLE_KEY: string;
    };
    Variables: {
      clerkUserId?: string;
    };
  };

  // ハンドラが D1 を触らないエンドポイントを使い、往復回数 = requireAuth が
  // 発行したクエリ数になるようにする。
  function buildApp() {
    const app = applyApiErrorHandling(new Hono<TestEnv>());
    app.use("/protected/*", requireAuth);
    app.get("/protected/ping", (c) => c.json({ ok: true }));
    return app;
  }

  const bindings = (d1: D1Database) => ({
    DB: d1,
    CLERK_SECRET_KEY: "test_secret",
    CLERK_PUBLISHABLE_KEY: "test_pub",
  });

  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    counts.clerkMiddleware = 0;
    counts.getMyAuthState = 0;
    counts.ensureUserExists = 0;
  });

  it("既存ユーザーのリクエストでは D1 への往復が 1 回になる", async () => {
    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "既存ユーザー",
      createdAt: now,
      updatedAt: now,
    });
    const counting = createCountingD1(env.DB);

    const res = await buildApp().request(
      "/protected/ping",
      { method: "GET" },
      bindings(counting.db),
    );

    expect(res.status).toBe(200);
    expect(counting.roundtrips()).toBe(1);
    expect(counts.getMyAuthState).toBe(1);
    expect(counts.ensureUserExists).toBe(0);
  });

  it("users 行が無い初回リクエストでは tombstone 確認後にプロビジョニングが走る", async () => {
    const counting = createCountingD1(env.DB);

    const res = await buildApp().request(
      "/protected/ping",
      { method: "GET" },
      bindings(counting.db),
    );

    expect(res.status).toBe(200);
    expect(counts.getMyAuthState).toBe(1);
    expect(counts.ensureUserExists).toBe(1);
  });
});
