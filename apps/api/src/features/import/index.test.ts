import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { importRoute } from "@/features/import";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testimport01";
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
  app.route("/me/import", importRoute);
  return app;
}

// Annict searchWorks のモック。titles ごとに返す作品を差し替える。
function mockAnnictSearch(
  handler: (titles: string[]) => { annictId: number; title: string }[],
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const titles: string[] = body.variables?.titles ?? [];
      return new Response(
        JSON.stringify({
          data: {
            searchWorks: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: handler(titles).map((w) => ({
                id: `Work-${w.annictId}`,
                annictId: w.annictId,
                malAnimeId: null,
                title: w.title,
                titleKana: null,
                titleEn: null,
                seasonName: null,
                seasonYear: null,
                image: { recommendedImageUrl: null },
              })),
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
}

describe("dアニメインポート API", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();
  });

  it("認証なしは 401", async () => {
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );
    const res = await buildApp().request(
      "/me/import/danime/match",
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
        "/me/import/danime/match",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ works: [] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        code: "annict_token_required",
      });
    });

    it("タイトルを Annict 作品へ照合して exact/candidates/none を返す", async () => {
      mockAnnictSearch((titles) =>
        titles.flatMap((t) =>
          t === "鬼滅の刃"
            ? [{ annictId: 1, title: "鬼滅の刃" }]
            : t === "無職転生"
              ? [
                  { annictId: 2, title: "無職転生 ～異世界行ったら本気だす～" },
                  {
                    annictId: 3,
                    title: "無職転生Ⅱ ～異世界行ったら本気だす～",
                  },
                ]
              : [],
        ),
      );
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              {
                danimeWorkId: "101",
                title: "鬼滅の刃",
                targetState: "WATCHED",
              },
              {
                danimeWorkId: "102",
                title: "無職転生",
                targetState: "WATCHING",
              },
              {
                danimeWorkId: "103",
                title: "ない作品",
                targetState: "WATCHED",
              },
            ],
          }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: {
          danimeWorkId: string;
          status: string;
          work: { annictWorkId: number } | null;
          candidates: { annictWorkId: number }[];
        }[];
        stats: {
          firstPassSearches: number;
          secondPassSearches: number;
          retries: number;
          elapsedMs: number;
        };
      };
      expect(body.results).toHaveLength(3);
      expect(body.results[0]?.status).toBe("exact");
      expect(body.results[0]?.work?.annictWorkId).toBe(1);
      expect(body.results[1]?.status).toBe("candidates");
      expect(body.results[1]?.candidates).toHaveLength(2);
      expect(body.results[2]?.status).toBe("none");
      // 所要時間の可視化: 検索回数・リトライ・経過時間を返す。
      expect(body.stats.firstPassSearches).toBe(1);
      expect(body.stats.secondPassSearches).toBeGreaterThan(0);
      expect(body.stats.retries).toBe(0);
      expect(body.stats.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("Annict が 429 を返した検索はリトライして回数を stats に記録する", async () => {
      let calls = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        calls++;
        if (calls === 1) {
          return new Response("rate limited", { status: 429 });
        }
        const body = JSON.parse((init?.body as string) ?? "{}");
        const titles: string[] = body.variables?.titles ?? [];
        return new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: titles.includes("鬼滅の刃")
                  ? [
                      {
                        id: "Work-1",
                        annictId: 1,
                        malAnimeId: null,
                        title: "鬼滅の刃",
                        titleKana: null,
                        titleEn: null,
                        seasonName: null,
                        seasonYear: null,
                        image: { recommendedImageUrl: null },
                      },
                    ]
                  : [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
            ],
          }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { status: string }[];
        stats: { retries: number };
      };
      expect(body.results[0]?.status).toBe("exact");
      expect(body.stats.retries).toBe(1);
    });

    // issue #219: Annict の LIKE 部分一致が解釈できないタイトル
    // （末尾の \ ・制御文字等）は HTTP 200 の GraphQL errors として返り、
    // リトライ不能な AnnictApiError(status=200) になる。1 件混入で
    // チャンク全体が 502 にならないことを保証する。
    it("GraphQL エラーになるタイトルが混ざっていても残りは照合して 200 を返す", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const titles: string[] = body.variables?.titles ?? [];
        // union（複数件）と「壊れた作品」系のクエリだけ GraphQL エラー
        if (titles.length > 1 || titles.some((t) => t.includes("壊れた作品"))) {
          return new Response(
            JSON.stringify({
              errors: [{ message: "LIKE pattern must not end with escape" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: titles.includes("鬼滅の刃")
                  ? [
                      {
                        id: "Work-1",
                        annictId: 1,
                        malAnimeId: null,
                        title: "鬼滅の刃",
                        titleKana: null,
                        titleEn: null,
                        seasonName: null,
                        seasonYear: null,
                        image: { recommendedImageUrl: null },
                      },
                    ]
                  : [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
              {
                danimeWorkId: "2",
                title: "壊れた作品",
                targetState: "WATCHED",
              },
            ],
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { danimeWorkId: string; status: string }[];
      };
      expect(body.results.find((r) => r.danimeWorkId === "1")?.status).toBe(
        "exact",
      );
      // エラーになるタイトルは未マッチ扱いで残る
      expect(body.results.find((r) => r.danimeWorkId === "2")?.status).toBe(
        "none",
      );
      // 落としたタイトルは切り分けのため warn ログに残す
      const warns = warnSpy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const dropped = warns.find(
        (l) => l.event === "danime_title_search_failed",
      );
      expect(dropped).toMatchObject({ level: "warn", annictStatus: 200 });
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    // issue #219: 第 2 パスは 1 検索語ずつ投げるため、不正な検索語の
    // GraphQL エラーが残るとリクエスト全体が 502 になる。その検索語だけを
    // 諦めて他の作品の照合は続行できることを保証する。
    it("第 2 パスの検索語だけが GraphQL エラーでも他の作品は照合して 200 を返す", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const titles: string[] = body.variables?.titles ?? [];
        // 第 2 パス（1 語ずつ）のクエリはすべて GraphQL エラーにする
        if (titles.length === 1) {
          return new Response(
            JSON.stringify({ errors: [{ message: "syntax error" }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: titles.includes("鬼滅の刃")
                  ? [
                      {
                        id: "Work-1",
                        annictId: 1,
                        malAnimeId: null,
                        title: "鬼滅の刃",
                        titleKana: null,
                        titleEn: null,
                        seasonName: null,
                        seasonYear: null,
                        image: { recommendedImageUrl: null },
                      },
                    ]
                  : [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
              {
                danimeWorkId: "2",
                title: "見つからない作品",
                targetState: "WATCHED",
              },
            ],
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { danimeWorkId: string; status: string }[];
      };
      expect(body.results.find((r) => r.danimeWorkId === "1")?.status).toBe(
        "exact",
      );
      expect(body.results.find((r) => r.danimeWorkId === "2")?.status).toBe(
        "none",
      );
      const warns = warnSpy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const dropped = warns.find(
        (l) =>
          l.event === "danime_title_search_failed" && l.phase === "secondPass",
      );
      expect(dropped).toMatchObject({ level: "warn", annictStatus: 200 });
      warnSpy.mockRestore();
    });

    // issue #219: 10 件単位の分割で端数が 1 件になるチャンク（11 作品目等）も
    // 単一検索語になる。複数作品の取り込みでその 1 件が GraphQL エラーでも
    // 全体を 502 にせず、そのタイトルだけ未マッチにする。
    it("1 件残りの第 1 パスチャンクが GraphQL エラーでも残りは照合して 200 を返す", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const titles: string[] = body.variables?.titles ?? [];
        if (titles.some((t) => t.includes("壊れた作品"))) {
          return new Response(
            JSON.stringify({
              errors: [{ message: "LIKE pattern must not end with escape" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: titles.map((t, i) => ({
                  id: `Work-${i}`,
                  annictId: i + 1,
                  malAnimeId: null,
                  title: t,
                  titleKana: null,
                  titleEn: null,
                  seasonName: null,
                  seasonYear: null,
                  image: { recommendedImageUrl: null },
                })),
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      // 10 件の正常タイトル + 末尾 1 件の不正タイトルで
      // 第 1 パスの端数チャンクが検索語 1 件になる。
      const works = [
        ...Array.from({ length: 10 }, (_, i) => ({
          danimeWorkId: `w${i}`,
          title: `作品${i}`,
          targetState: "WATCHED" as const,
        })),
        {
          danimeWorkId: "bad",
          title: "壊れた作品",
          targetState: "WATCHED" as const,
        },
      ];
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ works }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { danimeWorkId: string; status: string }[];
      };
      expect(body.results.find((r) => r.danimeWorkId === "bad")?.status).toBe(
        "none",
      );
      expect(body.results.filter((r) => r.status === "exact")).toHaveLength(10);
      warnSpy.mockRestore();
    });

    it("Annict 検索が全滅したときは 502 で失敗の構造化ログを出す", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // Response の body は一度しか読めないため呼び出しごとに作り直す。
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              errors: [{ message: "LIKE pattern must not end with escape" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );

      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "作品A", targetState: "WATCHED" },
              { danimeWorkId: "2", title: "作品B", targetState: "WATCHED" },
            ],
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ code: "annict_upstream" });
      // 原因を追えるよう、段階・件数・タイトル冒頭・Annict 側ステータス・
      // GraphQL エラーメッセージを構造化ログに残す
      const logs = errorSpy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const failed = logs.find((l) => l.event === "danime_match_failed");
      expect(failed).toMatchObject({
        level: "error",
        phase: "firstPass",
        titleCount: 2,
        annictStatus: 200,
      });
      expect(String(failed.error)).toContain("LIKE pattern");
      errorSpy.mockRestore();
    });

    it("Annict が 401 ならトークン無効として 401", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("unauthorized", { status: 401 }),
      );
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
            ],
          }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        code: "annict_token_invalid",
      });
    });

    // issue #219: D1 の annict_works キャッシュで照合できたタイトルは
    // Annict の検索（= 外部 fetch のサブリクエスト）を消費しない。
    it("D1 キャッシュで確定できるタイトルは Annict を呼ばない", async () => {
      await env.DB.prepare(
        `INSERT INTO annict_works
         (annict_work_id, node_id, title, title_kana, title_en,
          season_name, season_year, image_url, mal_anime_id, updated_at)
         VALUES (?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
      )
        .bind(1, "鬼滅の刃", "きめつのやいば", null, Date.now())
        .run();
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
            ],
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: {
          status: string;
          work: { annictWorkId: number; nodeId: string | null } | null;
        }[];
        stats: { localPassSearches: number };
      };
      expect(body.results[0]?.status).toBe("exact");
      expect(body.results[0]?.work?.annictWorkId).toBe(1);
      // D1 由来の候補は node_id 未取得（null）でも照合できる
      expect(body.results[0]?.work?.nodeId).toBeNull();
      // Annict（外部 fetch）は一度も呼ばれない
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(body.stats.localPassSearches).toBeGreaterThan(0);
    });

    it("D1 に無いタイトルだけを Annict に検索する", async () => {
      await env.DB.prepare(
        `INSERT INTO annict_works
         (annict_work_id, node_id, title, title_kana, title_en,
          season_name, season_year, image_url, mal_anime_id, updated_at)
         VALUES (?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
      )
        .bind(1, "鬼滅の刃", null, null, Date.now())
        .run();
      const fetchSpy = mockAnnictSearch((titles) =>
        titles.flatMap((t) =>
          t === "呪術廻戦" ? [{ annictId: 2, title: "呪術廻戦" }] : [],
        ),
      );

      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            works: [
              { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
              { danimeWorkId: "2", title: "呪術廻戦", targetState: "WATCHED" },
            ],
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { danimeWorkId: string; status: string }[];
      };
      expect(body.results.find((r) => r.danimeWorkId === "1")?.status).toBe(
        "exact",
      );
      expect(body.results.find((r) => r.danimeWorkId === "2")?.status).toBe(
        "exact",
      );
      // D1 で確定したタイトルは Annict の検索語に含まれない
      const sentTitles = fetchSpy.mock.calls.flatMap(([, init]) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return (body.variables?.titles ?? []) as string[];
      });
      expect(sentTitles).not.toContain("鬼滅の刃");
      expect(sentTitles).toContain("呪術廻戦");
    });

    // issue #219: Workers のサブリクエスト上限（Free プラン 50/req）を超える
    // 検索量になっても 502 にせず、未検索分を pending（= 次回に回す）で返す。
    it("予算を超える検索は打ち切られ、未検索分は pending で返る（502 にしない）", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchSpy = mockAnnictSearch(() => []);
      // 未解決が 100 件残る入力。D1 ローカル検索（4 クエリ）+ 第 1 パス
      // union（10 クエリ）+ 第 2 パスの単発再検索で予算（40）を使い切る。
      const works = Array.from({ length: 100 }, (_, i) => ({
        danimeWorkId: `w${i}`,
        title: `存在しない作品その${i}`,
        targetState: "WATCHED" as const,
      }));
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ works }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { status: string }[];
        stats: { pending: number; retries: number };
      };
      const pending = body.results.filter((r) => r.status === "pending");
      expect(pending.length).toBeGreaterThan(0);
      expect(body.stats.pending).toBe(pending.length);
      // 外部 fetch の総数が予算（40）を超えない。
      // （Workers の上限 50 には認証・通知用のサブリクエストを残す）
      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(40);
      // 予算切れは warn で 1 回だけ記録する（502 の失敗ログにはしない）
      const warns = warnSpy.mock.calls.map((c) => JSON.parse(String(c[0])));
      expect(
        warns.filter((l) => l.event === "danime_search_budget_exhausted"),
      ).toHaveLength(1);
      warnSpy.mockRestore();
    });

    it("works が空配列なら 400", async () => {
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ works: [] }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("works が上限（500）を超えると 400", async () => {
      const works = Array.from({ length: 501 }, (_, i) => ({
        danimeWorkId: `w${i}`,
        title: `作品${i}`,
        targetState: "WATCHED",
      }));
      const res = await buildApp().request(
        "/me/import/danime/match",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ works }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });
  });
});
