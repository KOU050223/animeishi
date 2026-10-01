import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { watchHistory } from "@/routes/watch-history";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

// D1 書き込み失敗（AnnictApiError ではない想定外の例外）を再現するため、
// 特定作品の upsertWatchHistory だけを落とせるよう authorizedDb をラップする。
const failUpsertIds = new Set<number>();
vi.mock("@/repository/authorizedDb", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/repository/authorizedDb")>();
  return {
    ...mod,
    authorizedDb: (db: Parameters<typeof mod.authorizedDb>[0], uid: string) => {
      const adb = mod.authorizedDb(db, uid);
      return {
        ...adb,
        upsertWatchHistory: (
          annictWorkId: number,
          values: Parameters<typeof adb.upsertWatchHistory>[1],
        ) =>
          failUpsertIds.has(annictWorkId)
            ? Promise.reject(new Error("D1 write failed"))
            : adb.upsertWatchHistory(annictWorkId, values),
      };
    },
  };
});

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testbulk01";
const ANNICT_HEADER = { "X-Annict-Token": "tok_test" };
const JSON_HEADERS = { "Content-Type": "application/json", ...ANNICT_HEADER };

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: { clerkUserId: string };
};

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/me/watch-histories", watchHistory);
  return app;
}

function entry(annictWorkId: number) {
  return { annictWorkId, state: "WATCHED" };
}

// updateStatus を nodeId ごとの挙動でモックする。
// failNodeIds: その Node ID の updateStatus を 500 にする。
// authFailAll: 全 updateStatus を 401 にする（並列実行でも打ち切り検証が
// 決定的になるよう、呼び出し順ではなく全件失敗にする）。
// authFailNodeIds: その Node ID の updateStatus を 401 にする。
function mockAnnictUpdate(
  opts: {
    failNodeIds?: string[];
    authFailAll?: boolean;
    authFailNodeIds?: string[];
    delayMs?: number;
    inflight?: { current: number; max: number };
  } = {},
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      if (opts.inflight) {
        opts.inflight.current++;
        opts.inflight.max = Math.max(opts.inflight.max, opts.inflight.current);
      }
      try {
        if (opts.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }
        return mockAnnictUpdateResponse(init, opts);
      } finally {
        if (opts.inflight) opts.inflight.current--;
      }
    });
}

function mockAnnictUpdateResponse(
  init: RequestInit | undefined,
  opts: {
    failNodeIds?: string[];
    authFailAll?: boolean;
    authFailNodeIds?: string[];
  },
) {
  const body = JSON.parse((init?.body as string) ?? "{}");
  const query: string = body.query ?? "";
  if (query.includes("updateStatus")) {
    if (
      opts.authFailAll ||
      opts.authFailNodeIds?.includes(body.variables?.workId)
    ) {
      return new Response("unauthorized", { status: 401 });
    }
    if (opts.failNodeIds?.includes(body.variables?.workId)) {
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
            nodes: [
              {
                id: `Work-${annictId}`,
                annictId,
                malAnimeId: null,
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
  return new Response(JSON.stringify({ data: {} }), { status: 200 });
}

type BulkBody = {
  results: { annictWorkId: number; ok: boolean; error?: string }[];
  aborted: boolean;
  elapsedMs: number;
};

describe("POST /me/watch-histories/bulk", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    failUpsertIds.clear();
  });

  it("認証なしは 401", async () => {
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );
    const res = await buildApp().request(
      "/me/watch-histories/bulk",
      { method: "POST", headers: JSON_HEADERS, body: "{}" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(401);
  });

  describe("認証あり", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("X-Annict-Token が無ければ 401", async () => {
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: [entry(1)] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
    });

    it("全件成功: Annict へ updateStatus し D1 に作品メタと履歴を書く", async () => {
      // annict_works にキャッシュが無い作品は searchWorks でメタを解決する。
      const fetchMock = mockAnnictUpdate();
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ entries: [entry(1), entry(2)] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as BulkBody;
      expect(body.aborted).toBe(false);
      expect(body.results).toEqual([
        { annictWorkId: 1, ok: true },
        { annictWorkId: 2, ok: true },
      ]);

      const histories = await db.query.watchHistory.findMany({
        where: (t, { eq }) => eq(t.userId, USER_ID),
      });
      expect(histories.map((h) => h.annictWorkId).sort()).toEqual([1, 2]);
      expect(histories[0].state).toBe("WATCHED");

      const cached = await db.query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 1),
      });
      expect(cached?.nodeId).toBe("Work-1");

      // 各作品に updateStatus が投げられている。
      const updateVars = fetchMock.mock.calls
        .map((c) => JSON.parse((c[1] as RequestInit).body as string))
        .filter((b) => (b.query as string).includes("updateStatus"))
        .map((b) => b.variables.workId);
      expect(updateVars.sort()).toEqual(["Work-1", "Work-2"]);
    });

    it("1 件だけ失敗しても他は登録され、D1 には成功分だけ残る", async () => {
      mockAnnictUpdate({ failNodeIds: ["Work-2"] });
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ entries: [entry(1), entry(2), entry(3)] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as BulkBody;
      expect(body.results[0].ok).toBe(true);
      expect(body.results[1]).toEqual({
        annictWorkId: 2,
        ok: false,
        error: "annict_upstream",
      });
      expect(body.results[2].ok).toBe(true);

      const histories = await db.query.watchHistory.findMany({
        where: (t, { eq }) => eq(t.userId, USER_ID),
      });
      // Annict 更新に失敗した作品は D1 にも書かれない（Annict が正）。
      expect(histories.map((h) => h.annictWorkId).sort()).toEqual([1, 3]);
    });

    it("Annict 401 で打ち切り、未着手の残りは aborted として返す", async () => {
      // 並列処理中に 401 を検知したら、まだ開始していない作品は
      // 「aborted」で返す。全件 401 にして順序に依存しない失敗にする。
      mockAnnictUpdate({ authFailAll: true });
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            entries: [1, 2, 3, 4, 5, 6, 7, 8].map(entry),
          }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as BulkBody;
      expect(body.aborted).toBe(true);
      // 処理中だった分は自身の 401 を、未着手分は aborted を返す。
      expect(
        body.results.every(
          (r) =>
            r.ok === false &&
            (r.error === "annict_token_invalid" || r.error === "aborted"),
        ),
      ).toBe(true);
      expect(body.results.some((r) => r.error === "aborted")).toBe(true);
      expect(body.results.some((r) => r.error === "annict_token_invalid")).toBe(
        true,
      );
      // 結果の順序は入力順を維持する。
      expect(body.results.map((r) => r.annictWorkId)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
    });

    it("entries は同時実行数を制限して並列に処理する", async () => {
      const inflight = { current: 0, max: 0 };
      mockAnnictUpdate({ delayMs: 10, inflight });
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ entries: [1, 2, 3, 4, 5, 6].map(entry) }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as BulkBody;
      expect(body.results.every((r) => r.ok)).toBe(true);
      // 逐次なら 1 のまま。並列なら 2 以上に達する。
      expect(inflight.max).toBeGreaterThanOrEqual(2);
      // 所要時間の可視化: サーバー側の経過時間を返す。
      expect(typeof body.elapsedMs).toBe("number");
    });

    it("nodeId はキャッシュ → searchWorks の順でサーバー側解決する", async () => {
      // キャッシュ済み作品（nodeId あり）と未キャッシュ作品を混ぜる。
      await db.insert(annictWorks).values({
        annictWorkId: 5,
        nodeId: "Work-cached",
        title: "キャッシュ済み",
        updatedAt: new Date(),
      });
      const fetchMock = mockAnnictUpdate();
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ entries: [entry(5), entry(6)] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const calls = fetchMock.mock.calls.map((c) =>
        JSON.parse((c[1] as RequestInit).body as string),
      );
      const updateWorkIds = calls
        .filter((b) => (b.query as string).includes("updateStatus"))
        .map((b) => b.variables.workId)
        .sort();
      // 5 はキャッシュの nodeId、6 は searchWorks で解決した Node ID が使われる。
      expect(updateWorkIds).toEqual(["Work-6", "Work-cached"]);
      // キャッシュ済みの 5 には searchWorks を投げない。
      const searchedIds = calls
        .filter((b) => (b.query as string).includes("searchWorks"))
        .flatMap((b) => b.variables.annictIds as number[]);
      expect(searchedIds).toEqual([6]);
    });

    it("クライアント提供の nodeId / メタは無視する（共有キャッシュ汚染対策）", async () => {
      const fetchMock = mockAnnictUpdate();
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            entries: [
              {
                annictWorkId: 7,
                state: "WATCHED",
                // 別作品を指す偽の nodeId とメタを混入させる。
                nodeId: "Work-evil",
                work: { title: "改ざんタイトル" },
              },
            ],
          }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const calls = fetchMock.mock.calls.map((c) =>
        JSON.parse((c[1] as RequestInit).body as string),
      );
      // searchWorks で正規解決した Node ID が updateStatus に使われ、
      // 入力された偽 nodeId は使われない。
      const updateWorkIds = calls
        .filter((b) => (b.query as string).includes("updateStatus"))
        .map((b) => b.variables.workId);
      expect(updateWorkIds).toEqual(["Work-7"]);

      // キャッシュには Annict 由来のメタが入り、偽タイトルは書き込まれない。
      const cached = await db.query.annictWorks.findFirst({
        where: (t, { eq }) => eq(t.annictWorkId, 7),
      });
      expect(cached?.title).toBe("作品7");
    });

    it("同一作品の重複エントリは最後の状態だけを適用する", async () => {
      // 並列処理だと Annict への反映順と D1 への保存順が入れ替わり得るため、
      // 同一 annictWorkId は入力順最後の状態に集約してから処理する
      // （逐次実行時代の「後勝ち」と同じ結果）。
      const fetchMock = mockAnnictUpdate();
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            entries: [
              { annictWorkId: 1, state: "WATCHING" },
              { annictWorkId: 1, state: "WATCHED" },
              { annictWorkId: 2, state: "WATCHED" },
            ],
          }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as BulkBody;
      // 結果は入力件数分（重複込み・入力順）で返り、重複分は同じ結果を共有する。
      expect(body.results).toEqual([
        { annictWorkId: 1, ok: true },
        { annictWorkId: 1, ok: true },
        { annictWorkId: 2, ok: true },
      ]);

      // 作品 1 の updateStatus は最後の状態 WATCHED で 1 回だけ送られる。
      const updateVars = fetchMock.mock.calls
        .map((c) => JSON.parse((c[1] as RequestInit).body as string))
        .filter((b) => (b.query as string).includes("updateStatus"))
        .map((b) => b.variables);
      expect(
        updateVars.filter((v) => v.workId === "Work-1").map((v) => v.state),
      ).toEqual(["WATCHED"]);

      // D1 にも同じ最終状態が残る（Annict と食い違わない）。
      const history = await db.query.watchHistory.findFirst({
        where: (t, { eq, and }) =>
          and(eq(t.userId, USER_ID), eq(t.annictWorkId, 1)),
      });
      expect(history?.state).toBe("WATCHED");
    });

    it("D1 書き込み等の想定外の失敗も per-item で返し、他作品の登録は続く", async () => {
      // AnnictApiError 以外の例外（D1 書き込み失敗等）を投げ直すと
      // Promise.all が即 reject し、応答後も他ワーカーの更新が続いて
      // クライアント表示と実態が食い違う。そのため internal_error として
      // その作品だけの失敗に変換する。
      failUpsertIds.add(2);
      mockAnnictUpdate();
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ entries: [entry(1), entry(2), entry(3)] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as BulkBody;
      expect(body.results).toEqual([
        { annictWorkId: 1, ok: true },
        { annictWorkId: 2, ok: false, error: "internal_error" },
        { annictWorkId: 3, ok: true },
      ]);
    });

    it("entries が空配列なら 400", async () => {
      const res = await buildApp().request(
        "/me/watch-histories/bulk",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ entries: [] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });
  });
});
