import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { watchHistory } from "@/routes/watch-history";
import {
  users,
  annictWorks,
  watchHistory as watchHistoryTable,
} from "@/db/schema";

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

// PUT の Annict 通信（updateStatus / searchWorks）をモックする。
// updateStatus は成功レスポンス、searchWorks は引数 annictIds の作品 1 件を返す。
// resolveNode を渡すと、searchWorks（nodeId 解決フォールバック）の戻り値を制御できる。
function mockAnnictUpdate(
  opts: {
    nodeId?: string;
    // searchWorks が空（該当作品なし）を返すか
    searchEmpty?: boolean;
    // searchWorks は成功させつつ updateStatus だけ 5xx で失敗させるか
    // （searchWorks 解決後の更新失敗時にキャッシュが書き換わらないことの検証用）
    updateFails?: boolean;
  } = {},
): ReturnType<typeof vi.spyOn> {
  const nodeId = opts.nodeId ?? "Work-1";
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const query: string = body.query ?? "";
      if (query.includes("updateStatus")) {
        if (opts.updateFails) {
          return new Response("server error", { status: 500 });
        }
        return new Response(
          JSON.stringify({
            data: { updateStatus: { clientMutationId: null } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (query.includes("searchWorks")) {
        const annictId: number = body.variables?.annictIds?.[0];
        return new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                nodes: opts.searchEmpty
                  ? []
                  : [
                      {
                        id: nodeId,
                        annictId,
                        title: `作品${annictId}`,
                        titleKana: null,
                        titleEn: null,
                        seasonName: null,
                        seasonYear: null,
                        image: { recommendedImageUrl: null },
                      },
                    ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
}

const ANNICT_HEADER = { "X-Annict-Token": "tok_test" };

// PUT / GET 共通の JSON + X-Annict-Token ヘッダ。
const PUT_HEADER = { "Content-Type": "application/json", ...ANNICT_HEADER };

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

    // 通常フローでは read-through 済みで nodeId がキャッシュに入っている前提。
    await db.insert(annictWorks).values({
      annictWorkId: ANNICT_WORK_ID,
      nodeId: "Work-12345",
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
      // ここはキャッシュの初期状態を作るのが目的なので DB に直接入れる。
      await db.insert(watchHistoryTable).values({
        userId: USER_ID,
        annictWorkId: ANNICT_WORK_ID,
        state: "WATCHING",
        updatedAt: new Date(),
      });

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

    it("PUT /me/watch-histories/:annictWorkId: Annict updateStatus 成功でキャッシュに反映する", async () => {
      const fetchMock = mockAnnictUpdate({ nodeId: "Work-12345" });
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: PUT_HEADER,
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

      // Annict updateStatus が Node ID と state を載せて呼ばれている。
      const updateCall = fetchMock.mock.calls.find((call) => {
        const init = call[1] as RequestInit;
        return (JSON.parse(init.body as string).query ?? "").includes(
          "updateStatus",
        );
      });
      expect(updateCall).toBeDefined();
      const vars = JSON.parse(
        (updateCall![1] as RequestInit).body as string,
      ).variables;
      expect(vars.workId).toBe("Work-12345");
      expect(vars.state).toBe("WATCHING");
    });

    it("PUT /me/watch-histories/:annictWorkId: ステータスを更新できる（upsert）", async () => {
      mockAnnictUpdate({ nodeId: "Work-12345" });
      const app = buildApp();

      await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: PUT_HEADER,
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: PUT_HEADER,
          body: JSON.stringify({ state: "WATCHED" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { state: string };
      expect(body.state).toBe("WATCHED");
    });

    it("PUT /me/watch-histories/:annictWorkId: X-Annict-Token が無ければ 401", async () => {
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

      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_token_required");
    });

    it("PUT /me/watch-histories/:annictWorkId: nodeId 未取得なら searchWorks で解決して更新", async () => {
      // read-through 前に初めて触れた作品（キャッシュに nodeId が無い）を模す。
      await db.insert(annictWorks).values({
        annictWorkId: 67890,
        nodeId: null,
        title: "未キャッシュ作品",
        updatedAt: new Date(),
      });

      const fetchMock = mockAnnictUpdate({ nodeId: "Work-67890" });
      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories/67890",
        {
          method: "PUT",
          headers: PUT_HEADER,
          body: JSON.stringify({ state: "WANNA_WATCH" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      // searchWorks（Node ID 解決）と updateStatus の両方が呼ばれている。
      const queries = fetchMock.mock.calls.map(
        (call) =>
          JSON.parse((call[1] as RequestInit).body as string).query as string,
      );
      expect(queries.some((q) => q.includes("searchWorks"))).toBe(true);
      expect(queries.some((q) => q.includes("updateStatus"))).toBe(true);

      // 解決した nodeId がキャッシュへ保存される。
      const cached = await db.query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 67890),
      });
      expect(cached?.nodeId).toBe("Work-67890");
    });

    it("PUT /me/watch-histories/:annictWorkId: searchWorks が空（作品なし）なら 404", async () => {
      mockAnnictUpdate({ searchEmpty: true });
      const app = buildApp();
      // キャッシュに無い annictWorkId へ更新 → searchWorks も空振り。
      const res = await app.request(
        "/me/watch-histories/99999",
        {
          method: "PUT",
          headers: PUT_HEADER,
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(404);
    });

    it("PUT /me/watch-histories/:annictWorkId: Annict が 401 なら annict_token_invalid で 401", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("unauthorized", { status: 401 }),
      );
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: PUT_HEADER,
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_token_invalid");
    });

    it("PUT /me/watch-histories/:annictWorkId: Annict が 5xx なら 502", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("server error", { status: 500 }),
      );
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: PUT_HEADER,
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_upstream");
    });

    it("PUT /me/watch-histories/:annictWorkId: Annict 更新失敗時はキャッシュを変更しない", async () => {
      // 既存キャッシュに WATCHING を入れておく。
      await db.insert(watchHistoryTable).values({
        userId: USER_ID,
        annictWorkId: ANNICT_WORK_ID,
        state: "WATCHING",
        updatedAt: new Date(),
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("server error", { status: 500 }),
      );

      const app = buildApp();
      await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: PUT_HEADER,
          body: JSON.stringify({ state: "WATCHED" }),
        },
        TEST_BINDINGS,
      );

      // Annict 更新が失敗したので state は WATCHING のまま。
      const row = await db.query.watchHistory.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.userId, USER_ID), eq(t.annictWorkId, ANNICT_WORK_ID)),
      });
      expect(row?.state).toBe("WATCHING");
    });

    it("PUT /me/watch-histories/:annictWorkId: searchWorks 解決後に更新失敗してもキャッシュを書き換えない", async () => {
      // read-through 前で nodeId 未取得の作品。searchWorks は成功するが
      // updateStatus が 5xx で失敗する → annict_works.nodeId も watch_history も
      // 書き換わってはいけない（「Annict 更新成功後にのみ同期」の不変条件）。
      const UNCACHED = 67890;
      await db.insert(annictWorks).values({
        annictWorkId: UNCACHED,
        nodeId: null,
        title: "未キャッシュ作品",
        updatedAt: new Date(),
      });
      mockAnnictUpdate({ nodeId: "Work-67890", updateFails: true });

      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${UNCACHED}`,
        {
          method: "PUT",
          headers: PUT_HEADER,
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(502);

      // nodeId は null のまま（searchWorks で解決したが upsert していない）。
      const cached = await db.query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, UNCACHED),
      });
      expect(cached?.nodeId).toBeNull();

      // watch_history も作られていない。
      const row = await db.query.watchHistory.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.userId, USER_ID), eq(t.annictWorkId, UNCACHED)),
      });
      expect(row).toBeUndefined();
    });

    it("DELETE /me/watch-histories/:annictWorkId: 視聴履歴を削除できる", async () => {
      const app = buildApp();
      // 削除対象を直接キャッシュに用意する。
      await db.insert(watchHistoryTable).values({
        userId: USER_ID,
        annictWorkId: ANNICT_WORK_ID,
        state: "WATCHING",
        updatedAt: new Date(),
      });

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
          headers: PUT_HEADER,
          body: JSON.stringify({ state: "invalid_status" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });
  });
});
