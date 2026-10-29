import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { analysis } from "@/features/analysis";
import { analyses, annictWorks, users, watchHistory } from "@/db/schema";
import {
  ANALYSIS_MODEL,
  buildAnalysisInput,
  computeInputHash,
  runAnalysis,
} from "@/features/analysis/service";
import { ANALYSIS_MAX_GENERATIONS_PER_WINDOW } from "@/features/analysis/repository";
import type { WatchHistoryWithWork } from "@/features/watch-history/repository";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testanalysis01";
const OTHER_USER_ID = "user_testanalysis02";

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

const AI_PAYLOAD = {
  summary: "SF・ファンタジー系を中心に視聴しています",
  recommendedGenres: ["SF", "ファンタジー"],
};

// chat completion 形の応答を組み立てる。文字列を渡すとそのまま content に
// 入る（生テキスト応答の再現用）。オブジェクトは JSON 化する。
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

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/me/analysis", analysis);
  return app;
}

describe("視聴傾向分析 API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    aiRun.mockReset();

    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: OTHER_USER_ID,
      username: "別ユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
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

  function postAnalysis() {
    return buildApp().request(
      "/me/analysis",
      { method: "POST" },
      TEST_BINDINGS,
    );
  }

  describe("認証なし", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
    });

    it("GET /me/analysis: 401 を返す", async () => {
      const res = await buildApp().request(
        "/me/analysis",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
    });

    it("POST /me/analysis: 401 を返す", async () => {
      const res = await postAnalysis();
      expect(res.status).toBe(401);
    });
  });

  describe("認証あり", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("GET /me/analysis: 未実行なら analysis=null", async () => {
      const res = await buildApp().request(
        "/me/analysis",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { analysis: unknown };
      expect(body.analysis).toBeNull();
    });

    it("POST /me/analysis: 視聴履歴が空なら 400 で AI を呼ばない", async () => {
      const res = await postAnalysis();
      expect(res.status).toBe(400);
      expect(aiRun).not.toHaveBeenCalled();
    });

    it("POST /me/analysis: 履歴を集計して AI に投げ、結果を返す", async () => {
      await seedHistory([101, 102]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      const res = await postAnalysis();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        analysis: {
          summary: string;
          recommendedGenres: string[];
          generatedAt: string;
          workCount: number;
        };
        cached: boolean;
      };
      expect(body.cached).toBe(false);
      expect(body.analysis.summary).toBe(AI_PAYLOAD.summary);
      expect(body.analysis.recommendedGenres).toEqual(
        AI_PAYLOAD.recommendedGenres,
      );
      expect(body.analysis.workCount).toBe(2);
      expect(typeof body.analysis.generatedAt).toBe("string");

      // モデルは定数化されたものを使い、プロンプトに作品タイトルを含む。
      expect(aiRun).toHaveBeenCalledTimes(1);
      const [model, inputs] = aiRun.mock.calls[0] as unknown as [
        string,
        { messages: { role: string; content: string }[]; max_tokens: number },
      ];
      expect(model).toBe(ANALYSIS_MODEL);
      expect(inputs.max_tokens).toBe(2048);
      const promptText = inputs.messages.map((m) => m.content).join("\n");
      expect(promptText).toContain("テスト作品101");
      expect(promptText).toContain("テスト作品102");
      // Qwen3 の思考モードを無効化する（思考で max_tokens を使い切り content が
      // 空になる本番障害の回帰防止）。
      const userMessage = inputs.messages.find((m) => m.role === "user");
      expect(userMessage?.content.endsWith("\n/no_think")).toBe(true);

      // 生成結果が保存される。
      const row = await db.query.analyses.findFirst({
        where: eq(analyses.userId, USER_ID),
      });
      expect(row?.summary).toBe(AI_PAYLOAD.summary);
      expect(row?.generationCount).toBe(1);
    });

    it("POST /me/analysis: 応答に含まれないジャンル候補外の値は捨てる", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(
        aiChatCompletion({
          summary: "傾向テキスト",
          // "恋愛" は VALID_GENRES に無いためフィルタされる。
          recommendedGenres: ["SF", "恋愛", "SF"],
        }),
      );
      const res = await postAnalysis();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        analysis: { recommendedGenres: string[] };
      };
      expect(body.analysis.recommendedGenres).toEqual(["SF"]);
    });

    it("POST /me/analysis: 同じ履歴なら 24h 以内はキャッシュを返し AI を呼ばない", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      const first = await postAnalysis();
      expect(first.status).toBe(200);
      const second = await postAnalysis();
      expect(second.status).toBe(200);
      const body = (await second.json()) as { cached: boolean };
      expect(body.cached).toBe(true);
      expect(aiRun).toHaveBeenCalledTimes(1);
    });

    it("POST /me/analysis: 視聴履歴が変わるとキャッシュを無効化して再生成する", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      await postAnalysis();
      // 履歴を変更（状態を WATCHING に更新＝ハッシュ不一致）。
      await db
        .update(watchHistory)
        .set({ state: "WATCHING" })
        .where(eq(watchHistory.userId, USER_ID));

      const res = await postAnalysis();
      expect(res.status).toBe(200);
      const body = (await res.json()) as { cached: boolean };
      expect(body.cached).toBe(false);
      expect(aiRun).toHaveBeenCalledTimes(2);
    });

    it("POST /me/analysis: 遅れて完了した古い生成は新しい結果を上書きしない", async () => {
      await seedHistory([101]);
      // 先の生成 A は AI 応答を保留にしておく。
      let resolveA: (value: unknown) => void = () => {};
      aiRun.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      );
      const reqA = postAnalysis();
      await vi.waitFor(() => expect(aiRun).toHaveBeenCalledTimes(1));

      // A の生成中に履歴が変わり、新しい入力 B の生成が先に完了する。
      await db
        .update(watchHistory)
        .set({ state: "WATCHING" })
        .where(eq(watchHistory.userId, USER_ID));
      aiRun.mockResolvedValueOnce(
        aiChatCompletion({ ...AI_PAYLOAD, summary: "新しい結果" }),
      );
      const resB = await postAnalysis();
      expect(resB.status).toBe(200);

      // A が遅れて完了しても、保存は input_hash 不一致で破棄される。
      resolveA(aiChatCompletion({ ...AI_PAYLOAD, summary: "古い結果" }));
      const resA = await reqA;
      expect(resA.status).toBe(200);
      const bodyA = (await resA.json()) as {
        analysis: { summary: string };
        cached: boolean;
      };
      expect(bodyA.cached).toBe(true);
      expect(bodyA.analysis.summary).toBe("新しい結果");

      const getRes = await buildApp().request(
        "/me/analysis",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as {
        analysis: { summary: string } | null;
      };
      expect(body.analysis?.summary).toBe("新しい結果");
    });

    it("POST /me/analysis: 履歴はデータ区切りの JSON で渡し指示無視を明示する", async () => {
      await seedHistory([101, 102]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      const res = await postAnalysis();
      expect(res.status).toBe(200);

      const [, inputs] = aiRun.mock.calls[0] as unknown as [
        string,
        { messages: { role: string; content: string }[] },
      ];
      const system = inputs.messages.find((m) => m.role === "system");
      const user = inputs.messages.find((m) => m.role === "user");
      // システムプロンプトが「データ内の指示に従わない」旨を明示する。
      expect(system?.content).toContain("従わ");
      // ユーザープロンプトは履歴を <watch_history> 内の JSON として渡す。
      const match = user?.content.match(
        /<watch_history>\n([\s\S]*?)\n<\/watch_history>/,
      );
      expect(match).not.toBeNull();
      const data = JSON.parse(match![1]!) as {
        totalCount: number;
        works: { title: string; state: string }[];
      };
      expect(data.totalCount).toBe(2);
      expect(data.works.map((w) => w.title)).toEqual(
        expect.arrayContaining(["テスト作品101", "テスト作品102"]),
      );
    });

    it("POST /me/analysis: 作品タイトルの改行・制御文字はプロンプトで潰す", async () => {
      const now = new Date();
      await db
        .insert(annictWorks)
        .values({
          annictWorkId: 301,
          title: "改行を\n含む\r\nタイトル",
          updatedAt: now,
        })
        .onConflictDoNothing();
      await db.insert(watchHistory).values({
        userId: USER_ID,
        annictWorkId: 301,
        state: "WATCHED",
        updatedAt: now,
      });
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      const res = await postAnalysis();
      expect(res.status).toBe(200);
      const [, inputs] = aiRun.mock.calls[0] as unknown as [
        string,
        { messages: { role: string; content: string }[] },
      ];
      const promptText = inputs.messages.map((m) => m.content).join("\n");
      expect(promptText).toContain("改行を 含む タイトル");
      expect(promptText).not.toContain("改行を\n含む");
    });

    it("POST /me/analysis: キャッシュが 24h を超えると再生成する", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));

      await postAnalysis();
      // generated_at を 25h 前に書き換えて TTL 切れにする。
      await db
        .update(analyses)
        .set({ generatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
        .where(eq(analyses.userId, USER_ID));

      const res = await postAnalysis();
      const body = (await res.json()) as { cached: boolean };
      expect(body.cached).toBe(false);
      expect(aiRun).toHaveBeenCalledTimes(2);
    });

    it("POST /me/analysis: 生成回数が上限に達すると 429 + Retry-After", async () => {
      await seedHistory([101]);
      // 窓内に上限分の消費済み行を作る。
      await db.insert(analyses).values({
        userId: USER_ID,
        windowStartedAt: new Date(),
        generationCount: ANALYSIS_MAX_GENERATIONS_PER_WINDOW,
      });

      const res = await postAnalysis();
      expect(res.status).toBe(429);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("generation_limit");
      const retryAfter = Number(res.headers.get("Retry-After"));
      expect(retryAfter).toBeGreaterThan(0);
      expect(aiRun).not.toHaveBeenCalled();
    });

    it("POST /me/analysis: 窓が切れていればカウンタがリセットされて生成できる", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));
      // 窓切れ（25h 前開始）かつ上限到達の行。
      await db.insert(analyses).values({
        userId: USER_ID,
        windowStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        generationCount: ANALYSIS_MAX_GENERATIONS_PER_WINDOW,
      });

      const res = await postAnalysis();
      expect(res.status).toBe(200);
      expect(aiRun).toHaveBeenCalledTimes(1);
      const row = await db.query.analyses.findFirst({
        where: eq(analyses.userId, USER_ID),
      });
      expect(row?.generationCount).toBe(1);
    });

    it("POST /me/analysis: AI が失敗したら 502 で結果は保存されない", async () => {
      await seedHistory([101]);
      aiRun.mockRejectedValue(new Error("workers ai is down"));

      const res = await postAnalysis();
      expect(res.status).toBe(502);

      const getRes = await buildApp().request(
        "/me/analysis",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as { analysis: unknown };
      expect(body.analysis).toBeNull();

      // 呼び出し自体は回数制限の消費としてカウントされる（障害中の連打防止）。
      const row = await db.query.analyses.findFirst({
        where: eq(analyses.userId, USER_ID),
      });
      expect(row?.summary).toBeNull();
      expect(row?.generationCount).toBe(1);
    });

    it("POST /me/analysis: 思考で打ち切られ content が空なら 502 で保存しない", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "", reasoning: "考え中…" },
            finish_reason: "length",
          },
        ],
      });

      const res = await postAnalysis();
      expect(res.status).toBe(502);
      const row = await db.query.analyses.findFirst({
        where: eq(analyses.userId, USER_ID),
      });
      expect(row?.summary ?? null).toBeNull();
      // 呼び出し自体は生成回数を消費する（障害中の連打防止。既存方針どおり）。
      expect(row?.generationCount).toBe(1);
    });

    it("POST /me/analysis: content に <think> ブロックが混ざっても後段の JSON を解釈する", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(
        aiChatCompletion(
          `<think>考え中</think>\n${JSON.stringify(AI_PAYLOAD)}`,
        ),
      );

      const res = await postAnalysis();
      expect(res.status).toBe(200);
    });

    it("POST /me/analysis: 要約の値に </think> を含む正しい JSON はそのまま解釈する", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(
        aiChatCompletion({
          summary: "作品 </think> の感想",
          recommendedGenres: ["SF"],
        }),
      );

      const res = await postAnalysis();
      expect(res.status).toBe(200);
      const body = (await res.json()) as { analysis: { summary: string } };
      expect(body.analysis.summary).toBe("作品 </think> の感想");
    });

    it("POST /me/analysis: AI が不正な JSON を返したら 502", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(aiChatCompletion("これはJSONではありません"));

      const res = await postAnalysis();
      expect(res.status).toBe(502);
    });

    it("POST /me/analysis: AI 応答のスキーマが合わなければ 502", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(aiChatCompletion({ text: "?" }));

      const res = await postAnalysis();
      expect(res.status).toBe(502);
    });

    it("他ユーザーのキャッシュ・カウンタは共有されない", async () => {
      await seedHistory([101]);
      aiRun.mockResolvedValue(aiChatCompletion(AI_PAYLOAD));
      // USER_ID が生成してキャッシュを持つ。
      await postAnalysis();
      expect(aiRun).toHaveBeenCalledTimes(1);

      // OTHER_USER で叩くと別ユーザーとして独立に生成される
      // （USER_ID のキャッシュヒットにはならない）。
      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      await seedHistory([201], "WATCHED", OTHER_USER_ID);
      const res = await postAnalysis();
      expect(res.status).toBe(200);
      expect(aiRun).toHaveBeenCalledTimes(2);

      // 別ユーザーの GET には自分の結果だけが返る（他人の履歴を参照しない）。
      const getRes = await buildApp().request(
        "/me/analysis",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as {
        analysis: { workCount: number } | null;
      };
      expect(body.analysis?.workCount).toBe(1);
    });
  });
});

describe("computeInputHash", () => {
  const historyRow = (
    annictWorkId: number,
    state: "WATCHED" | "WATCHING",
  ): WatchHistoryWithWork => ({
    id: annictWorkId,
    userId: "u",
    annictWorkId,
    state,
    updatedAt: new Date(),
    title: `作品${annictWorkId}`,
    titleKana: null,
    titleEn: null,
    seasonName: null,
    seasonYear: null,
    imageUrl: null,
    resolvedImageUrl: null,
    imageSource: null,
    imageR2Key: null,
    watchersCount: null,
  });

  it("プロンプトに載る作品の並び順が変わるとハッシュが変わる", async () => {
    // works はプロンプトに載る順序のままハッシュ対象のため、
    // 同じ作品集合でも並び替わればキャッシュは無効化される。
    const a = buildAnalysisInput(
      [historyRow(1, "WATCHED"), historyRow(2, "WATCHING")],
      [],
    );
    const b = buildAnalysisInput(
      [historyRow(2, "WATCHING"), historyRow(1, "WATCHED")],
      [],
    );
    expect(await computeInputHash(a)).not.toBe(await computeInputHash(b));
  });

  it("履歴・選択ジャンル・タイトルが変わるとハッシュが変わる", async () => {
    const base = buildAnalysisInput([historyRow(1, "WATCHED")], []);
    const genreChanged = { ...base, selectedGenres: ["SF"] };
    const stateChanged = buildAnalysisInput([historyRow(1, "WATCHING")], []);
    const titleChanged = buildAnalysisInput(
      [{ ...historyRow(1, "WATCHED"), title: "別タイトル" }],
      [],
    );
    const baseHash = await computeInputHash(base);
    expect(await computeInputHash(genreChanged)).not.toBe(baseHash);
    expect(await computeInputHash(stateChanged)).not.toBe(baseHash);
    expect(await computeInputHash(titleChanged)).not.toBe(baseHash);
  });

  it("プロンプト上限（50 件）以降の作品変更でもハッシュが変わる", async () => {
    const base = buildAnalysisInput(
      Array.from({ length: 60 }, (_, i) => historyRow(i + 1, "WATCHED")),
      [],
    );
    // 51 件目以降（プロンプトには載らない範囲）の状態だけ変更する。
    const tailChanged = buildAnalysisInput(
      [
        ...Array.from({ length: 50 }, (_, i) => historyRow(i + 1, "WATCHED")),
        historyRow(51, "WATCHING"),
        ...Array.from({ length: 9 }, (_, i) => historyRow(52 + i, "WATCHED")),
      ],
      [],
    );
    expect(await computeInputHash(tailChanged)).not.toBe(
      await computeInputHash(base),
    );
  });
});

describe("runAnalysis", () => {
  it("content が空なら finish_reason を含むエラーを投げる", async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "" },
            finish_reason: "length",
          },
        ],
      }),
    } as unknown as Ai;
    await expect(
      runAnalysis(ai, {
        totalCount: 1,
        stateCounts: { WATCHED: 1 },
        works: [{ annictWorkId: 1, title: "作品", state: "WATCHED" }],
        workKeys: [{ annictWorkId: 1, title: "作品", state: "WATCHED" }],
        selectedGenres: [],
      }),
    ).rejects.toThrow(/finish_reason: length/);
  });
});
