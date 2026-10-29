import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { analysis } from "@/features/analysis";
import {
  analyses,
  annictWorks,
  recommendations,
  users,
  watchHistory,
} from "@/db/schema";
import { RECOMMENDATION_MAX_GENERATIONS_PER_WINDOW } from "@/features/analysis/recommendationRepository";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testreco01";
const OTHER_USER_ID = "user_testreco02";
const ANNICT_TOKEN = "annict-token-for-test";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
    AI: Ai;
  };
  Variables: {
    clerkUserId: string;
  };
};

// Workers AI バインディングのモック。実モデルは呼ばない。
const aiRun = vi.fn();

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
  AI: { run: aiRun } as unknown as Ai,
};

// AI が返すおすすめ候補（chat completion 形で包む）。
const AI_PAYLOAD = {
  recommendations: [
    { title: "おすすめ作品9001", reason: "SF 好きに合いそう" },
    { title: "おすすめ作品9002", reason: "泣ける話題作" },
  ],
};

function aiChatCompletion(payload: unknown) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            typeof payload === "string" ? payload : JSON.stringify(payload),
        },
        finish_reason: "stop",
      },
    ],
  };
}

// Annict searchWorks の応答を組み立てる。searchAnnictWorksByTitle(s) は
// グローバル fetch を呼ぶため、vi.stubGlobal で差し替える。
function searchWorksResponse(nodes: unknown[]): Response {
  return new Response(
    JSON.stringify({
      data: {
        searchWorks: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes,
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function workNode(annictId: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `node-${annictId}`,
    annictId,
    malAnimeId: null,
    title: `おすすめ作品${annictId}`,
    titleKana: null,
    titleEn: null,
    seasonName: "2026-spring",
    seasonYear: 2026,
    image: { recommendedImageUrl: `https://img/${annictId}.jpg` },
    ...overrides,
  };
}

// union 検索（titles 複数）でも単発検索でも同じノード集合を返す既定モック。
// Response の body は 1 回しか読めないため、呼び出しごとに新しく作る。
function stubAnnictFetch(nodes: unknown[]) {
  const fetchMock = vi
    .fn()
    .mockImplementation(() => Promise.resolve(searchWorksResponse(nodes)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/me/analysis", analysis);
  return app;
}

describe("AI おすすめ生成 API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    aiRun.mockReset();

    const now = new Date();
    for (const [id, name] of [
      [USER_ID, "テストユーザー"],
      [OTHER_USER_ID, "別ユーザー"],
    ] as const) {
      await db.insert(users).values({
        id,
        username: name,
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seedHistory(
    workIds: number[],
    state: "WATCHED" | "WATCHING" = "WATCHED",
    userId = USER_ID,
  ) {
    const now = new Date();
    for (const id of workIds) {
      await db
        .insert(annictWorks)
        .values({
          annictWorkId: id,
          title: `テスト作品${id}`,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
    await db.insert(watchHistory).values(
      workIds.map((id, i) => ({
        userId,
        annictWorkId: id,
        state,
        updatedAt: new Date(now.getTime() + i * 1000),
      })),
    );
  }

  function getRecommendations() {
    return buildApp().request(
      "/me/analysis/recommendations",
      { method: "GET" },
      TEST_BINDINGS,
    );
  }

  function postRecommendations(annictToken: string | null = ANNICT_TOKEN) {
    const headers: Record<string, string> = {};
    if (annictToken) headers["X-Annict-Token"] = annictToken;
    return buildApp().request(
      "/me/analysis/recommendations",
      { method: "POST", headers },
      TEST_BINDINGS,
    );
  }

  describe("認証なし", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
    });

    it("GET: 401 を返す", async () => {
      const res = await getRecommendations();
      expect(res.status).toBe(401);
    });

    it("POST: 401 を返す", async () => {
      const res = await postRecommendations();
      expect(res.status).toBe(401);
    });
  });

  describe("認証あり", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("GET: 未実行なら recommendations=null", async () => {
      const res = await getRecommendations();
      expect(res.status).toBe(200);
      const body = (await res.json()) as { recommendations: unknown };
      expect(body.recommendations).toBeNull();
    });

    it("POST: 視聴履歴が空なら 400 で AI を呼ばない", async () => {
      const res = await postRecommendations();
      expect(res.status).toBe(400);
      expect(aiRun).not.toHaveBeenCalled();
    });

    it("POST: Annict 未連携（トークン無し）なら 401 で生成枠を消費しない", async () => {
      await seedHistory([101]);
      const res = await postRecommendations(null);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_token_required");
      expect(aiRun).not.toHaveBeenCalled();
      const row = await db.query.recommendations.findFirst({
        where: eq(recommendations.userId, USER_ID),
      });
      expect(row).toBeUndefined();
    });

    it("POST: AI の候補を Annict に照合して履歴外の作品だけ返し保存する", async () => {
      // 履歴に 9002 を持たせ、AI がそれも候補に出す状況を作る。
      await seedHistory([101, 9002]);
      stubAnnictFetch([workNode(9001), workNode(9002)]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      const res = await postRecommendations();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        recommendations: {
          works: {
            annictWorkId: number;
            title: string;
            hostedImageUrl: string | null;
            reason: string;
          }[];
          generatedAt: string;
        };
        cached: boolean;
      };
      expect(body.cached).toBe(false);
      // 履歴にある 9002 は除外され、理由は対応する候補のものが残る。
      expect(body.recommendations.works.map((w) => w.annictWorkId)).toEqual([
        9001,
      ]);
      expect(body.recommendations.works[0]?.reason).toBe("SF 好きに合いそう");
      expect(body.recommendations.works[0]?.hostedImageUrl).toContain(
        "/images/works/9001",
      );

      // 生成結果が保存される。
      const row = await db.query.recommendations.findFirst({
        where: eq(recommendations.userId, USER_ID),
      });
      expect(row?.generationCount).toBe(1);
      const savedWorks = JSON.parse(row?.worksJson ?? "[]") as {
        annictWorkId: number;
      }[];
      expect(savedWorks.map((w) => w.annictWorkId)).toEqual([9001]);

      // 照合した作品は annict_works にキャッシュされる（WANNA_WATCH の
      // nodeId 解決に使う）。
      const cachedWork = await db.query.annictWorks.findFirst({
        where: eq(annictWorks.annictWorkId, 9001),
      });
      expect(cachedWork?.nodeId).toBe("node-9001");
    });

    it("POST: 保存済みの分析結果があるとプロンプトに傾向を含める", async () => {
      await seedHistory([101]);
      stubAnnictFetch([]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));
      await db.insert(analyses).values({
        userId: USER_ID,
        summary: "SF 中心の視聴傾向",
        genresJson: JSON.stringify(["SF"]),
        generatedAt: new Date(),
        workCount: 1,
        windowStartedAt: new Date(),
        generationCount: 1,
      });

      const res = await postRecommendations();
      expect(res.status).toBe(200);
      const [, inputs] = aiRun.mock.calls[0] as unknown as [
        string,
        { messages: { role: string; content: string }[] },
      ];
      const user = inputs.messages.find((m) => m.role === "user");
      expect(user?.content).toContain("SF 中心の視聴傾向");
      expect(user?.content).toContain("現在のシーズン");
      expect(user?.content.endsWith("\n/no_think")).toBe(true);
    });

    it("POST: 同じ履歴なら 24h 以内はキャッシュを返し AI・Annict を呼ばない", async () => {
      await seedHistory([101]);
      const fetchMock = stubAnnictFetch([workNode(9001)]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      await postRecommendations();
      const callsAfterFirst = fetchMock.mock.calls.length;
      const second = await postRecommendations(null); // トークン無しでもキャッシュは返る
      expect(second.status).toBe(200);
      const body = (await second.json()) as { cached: boolean };
      expect(body.cached).toBe(true);
      expect(aiRun).toHaveBeenCalledTimes(1);
      // キャッシュ応答では Annict を呼ばない。
      expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    });

    it("POST: 視聴履歴が変わるとキャッシュを無効化して再生成する", async () => {
      await seedHistory([101]);
      stubAnnictFetch([workNode(9001)]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      await postRecommendations();
      await db
        .update(watchHistory)
        .set({ state: "WATCHING" })
        .where(eq(watchHistory.userId, USER_ID));

      const res = await postRecommendations();
      const body = (await res.json()) as { cached: boolean };
      expect(body.cached).toBe(false);
      expect(aiRun).toHaveBeenCalledTimes(2);
    });

    it("POST: 生成回数が上限に達すると 429 + Retry-After", async () => {
      await seedHistory([101]);
      await db.insert(recommendations).values({
        userId: USER_ID,
        windowStartedAt: new Date(),
        generationCount: RECOMMENDATION_MAX_GENERATIONS_PER_WINDOW,
      });

      const res = await postRecommendations();
      expect(res.status).toBe(429);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("generation_limit");
      const retryAfter = Number(res.headers.get("Retry-After"));
      expect(retryAfter).toBeGreaterThan(0);
      expect(aiRun).not.toHaveBeenCalled();
    });

    it("POST: 窓が切れていればカウンタがリセットされて生成できる", async () => {
      await seedHistory([101]);
      stubAnnictFetch([workNode(9001)]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));
      await db.insert(recommendations).values({
        userId: USER_ID,
        windowStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        generationCount: RECOMMENDATION_MAX_GENERATIONS_PER_WINDOW,
      });

      const res = await postRecommendations();
      expect(res.status).toBe(200);
      const row = await db.query.recommendations.findFirst({
        where: eq(recommendations.userId, USER_ID),
      });
      expect(row?.generationCount).toBe(1);
    });

    it("POST: AI が失敗したら 502 で結果は保存されない", async () => {
      await seedHistory([101]);
      stubAnnictFetch([workNode(9001)]);
      aiRun.mockRejectedValue(new Error("workers ai is down"));

      const res = await postRecommendations();
      expect(res.status).toBe(502);
      const getRes = await getRecommendations();
      const body = (await getRes.json()) as { recommendations: unknown };
      expect(body.recommendations).toBeNull();
      // 呼び出し自体は回数制限の消費としてカウントされる（障害中の連打防止）。
      const row = await db.query.recommendations.findFirst({
        where: eq(recommendations.userId, USER_ID),
      });
      expect(row?.generationCount).toBe(1);
    });

    it("POST: Annict の照合が 401 なら annict_token_invalid を返す", async () => {
      await seedHistory([101]);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("", { status: 401 })),
      );
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      const res = await postRecommendations();
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("annict_token_invalid");
    });

    it("POST: Annict の照合が 500 なら上流障害として 502 を返す", async () => {
      await seedHistory([101]);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("", { status: 500 })),
      );
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      const res = await postRecommendations();
      expect(res.status).toBe(502);
    });

    it("GET: 他ユーザーの結果は返らない", async () => {
      await seedHistory([101]);
      stubAnnictFetch([workNode(9001)]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));
      await postRecommendations();

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      const res = await getRecommendations();
      const body = (await res.json()) as { recommendations: unknown };
      expect(body.recommendations).toBeNull();
    });
  });
});

describe("matchCandidateWorks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function workNode(annictId: number, overrides: Record<string, unknown> = {}) {
    return {
      id: `node-${annictId}`,
      annictId,
      malAnimeId: null,
      title: `作品${annictId}`,
      titleKana: null,
      titleEn: null,
      seasonName: "2026-spring",
      seasonYear: 2026,
      image: { recommendedImageUrl: null },
      ...overrides,
    };
  }

  it("union 検索の結果から各候補の最一致作品を選び履歴外だけ残す", async () => {
    const { matchCandidateWorks } =
      await import("@/features/analysis/recommendationService");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            searchWorks: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                workNode(1, { title: "進撃の巨人" }),
                workNode(2, { title: "呪術廻戦" }),
                workNode(3, { title: "無関係な作品" }),
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const matched = await matchCandidateWorks(
      "tok",
      [
        { title: "進撃の巨人", reason: "A" },
        { title: "呪術廻戦", reason: "B" },
        { title: "無関係な作品", reason: "C" }, // 履歴に入っている想定
      ],
      new Set([3]),
    );

    expect(matched.map((m) => m.work.annictWorkId)).toEqual([1, 2]);
    expect(matched.map((m) => m.reason)).toEqual(["A", "B"]);
    // union 検索 1 回だけ（全候補が union 結果で解決できた）。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("union で拾えなかった候補は単発検索で救い、別作品への誤照合はしない", async () => {
    const { matchCandidateWorks } =
      await import("@/features/analysis/recommendationService");
    // union は空、単発検索（2 回目以降）はタイトルに応じた結果を返す。
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockImplementation((_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string) as {
          variables: { titles: string[] };
        };
        const title = body.variables.titles[0] ?? "";
        const nodes =
          title === "存在しない作品"
            ? [workNode(99, { title: "全然違う作品" })]
            : [workNode(7, { title })];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                searchWorks: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes,
                },
              },
            }),
            { status: 200 },
          ),
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    const matched = await matchCandidateWorks(
      "tok",
      [
        { title: "ぼっち・ざ・ろっく！", reason: "A" },
        { title: "存在しない作品", reason: "B" },
      ],
      new Set(),
    );

    // 1 件目は単発検索で解決。2 件目は「全然違う作品」への誤照合はせず落とす。
    expect(matched.map((m) => m.work.annictWorkId)).toEqual([7]);
    // union 1 回 + 単発検索 2 件（unmatched 分）。
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("複数候補が同じ作品に寄ったときは先に出た候補だけ残す", async () => {
    const { matchCandidateWorks } =
      await import("@/features/analysis/recommendationService");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              searchWorks: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [workNode(1, { title: "鬼滅の刃" })],
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const matched = await matchCandidateWorks(
      "tok",
      [
        { title: "鬼滅の刃", reason: "A" },
        { title: "鬼滅の刃 無限列車編", reason: "B" },
      ],
      new Set(),
    );

    expect(matched.map((m) => m.reason)).toEqual(["A"]);
  });
});
