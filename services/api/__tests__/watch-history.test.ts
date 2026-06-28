import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { watchHistory } from "@/routes/watch-history";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testwh001";
const ANNICT_WORK_ID = 12345;

// Annict GraphQL（global fetch）をモックする。
// GET /me/watch-histories は libraryEntries を read-through 全置換するため、
// Annict から返ってくる作品一覧をここで差し替える。
function mockAnnictLibrary(
  nodes: {
    annictId: number;
    state: string | null;
    title?: string;
  }[],
): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          viewer: {
            libraryEntries: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: nodes.map((n) => ({
                status: n.state === null ? null : { state: n.state },
                work: {
                  annictId: n.annictId,
                  title: n.title ?? `作品${n.annictId}`,
                  titleKana: null,
                  titleEn: null,
                  seasonName: null,
                  seasonYear: null,
                  image: { recommendedImageUrl: null },
                },
              })),
            },
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

const ANNICT_HEADER = { "X-Annict-Token": "tok_test" };

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: {
    clerkUserId: string;
  };
};

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function buildApp() {
  const app = new Hono<TestEnv>();
  app.route("/me/watch-histories", watchHistory);
  return app;
}

describe("視聴履歴 API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();

    // テスト用 annict_work・ユーザーを事前作成
    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(annictWorks).values({
      annictWorkId: ANNICT_WORK_ID,
      title: "テストアニメ",
      updatedAt: now,
    });
  });

  describe("認証なし", () => {
    it("GET /me/watch-histories: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
    });
  });

  describe("認証あり", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("GET /me/watch-histories: X-Annict-Token が無ければ 401", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_token_required");
    });

    it("GET /me/watch-histories: Annict ライブラリが空なら空配列", async () => {
      mockAnnictLibrary([]);
      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body).toEqual([]);
    });

    it("GET /me/watch-histories: Annict libraryEntries を read-through 全置換する", async () => {
      const app = buildApp();
      // 事前にローカルへ別状態を入れておく（全置換で上書きされることを確認）。
      // PUT は Annict を叩かずローカル DB のみ更新するため fetch モック不要。
      await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      // Annict 側は別作品 + 別状態を返す
      const NEW_WORK = 67890;
      mockAnnictLibrary([
        { annictId: ANNICT_WORK_ID, state: "WATCHED", title: "テストアニメ" },
        { annictId: NEW_WORK, state: "WANNA_WATCH", title: "新規アニメ" },
      ]);

      const res = await app.request(
        "/me/watch-histories",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        annictWorkId: number;
        state: string;
      }[];
      expect(body).toHaveLength(2);
      expect(body.find((h) => h.annictWorkId === ANNICT_WORK_ID)?.state).toBe(
        "WATCHED",
      );
      expect(body.find((h) => h.annictWorkId === NEW_WORK)?.state).toBe(
        "WANNA_WATCH",
      );
    });

    it("GET /me/watch-histories: NO_STATE の作品は履歴に含めない", async () => {
      mockAnnictLibrary([
        { annictId: ANNICT_WORK_ID, state: "WATCHING" },
        { annictId: 67890, state: "NO_STATE", title: "未設定作品" },
      ]);

      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { annictWorkId: number }[];
      expect(body).toHaveLength(1);
      expect(body[0].annictWorkId).toBe(ANNICT_WORK_ID);
    });

    it("GET /me/watch-histories: Annict が 401 ならトークン無効として 401", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("unauthorized", { status: 401 }),
      );

      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_token_invalid");
    });

    it("GET /me/watch-histories: Annict が 5xx なら 502", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("server error", { status: 500 }),
      );

      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_upstream");
    });

    it("PUT /me/watch-histories/:annictWorkId: 視聴履歴を追加できる", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        annictWorkId: number;
        state: string;
      };
      expect(body.annictWorkId).toBe(ANNICT_WORK_ID);
      expect(body.state).toBe("WATCHING");
    });

    it("PUT /me/watch-histories/:annictWorkId: ステータスを更新できる（upsert）", async () => {
      const app = buildApp();

      await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHED" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { state: string };
      expect(body.state).toBe("WATCHED");
    });

    it("DELETE /me/watch-histories/:annictWorkId: 視聴履歴を削除できる", async () => {
      const app = buildApp();

      await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      const deleteRes = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(deleteRes.status).toBe(200);

      // 削除後は Annict 側も空のため read-through GET が空配列を返す。
      mockAnnictLibrary([]);
      const getRes = await app.request(
        "/me/watch-histories",
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as unknown[];
      expect(body).toHaveLength(0);
    });

    it("PUT /me/watch-histories/:annictWorkId: バリデーションエラー（不正なステータス）は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "invalid_status" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("PUT /me/watch-histories/:annictWorkId: 存在しない作品IDは 404", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories/99999",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(404);
    });
  });
});
