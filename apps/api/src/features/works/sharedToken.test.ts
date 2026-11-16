// 未連携の利用者が共用トークン（ANNICT_SHARED_READ_TOKEN）で作品情報を引く経路
// （issue #561）。vi.mock を使うため isolated プロジェクトで動かす。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { works } from "@/features/works";
import { sharedWorkDetailCacheUrl, titleSearchCacheUrl } from "./service";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testshared001";
const SHARED_TOKEN = "tok_shared";
const WORK_ID = 4001;
const SEARCH_TITLE = "共用検索";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
    ANNICT_SHARED_READ_TOKEN?: string;
  };
  Variables: { clerkUserId: string };
};

const BASE_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};
const SHARED_BINDINGS = {
  ...BASE_BINDINGS,
  ANNICT_SHARED_READ_TOKEN: ` ${SHARED_TOKEN}\n`,
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/works", works);
  return app;
}

// 検索・詳細・キャスト・lookup のどのクエリにも通る作品ノード。
// recommendedImageUrl を有効な URL にして画像の同期補完（Kitsu 往復）を起こさない。
const WORK_NODE = {
  id: `node-${WORK_ID}`,
  annictId: WORK_ID,
  malAnimeId: null,
  title: "共用アニメ",
  titleKana: null,
  titleEn: null,
  titleRo: null,
  seasonName: "2026-spring",
  seasonYear: 2026,
  media: "TV",
  episodesCount: 12,
  noEpisodes: false,
  watchersCount: 100,
  reviewsCount: 0,
  satisfactionRate: null,
  officialSiteUrl: null,
  officialSiteUrlEn: null,
  wikipediaUrl: null,
  wikipediaUrlEn: null,
  twitterUsername: null,
  twitterHashtag: null,
  // 共用トークンのクエリはこのフィールドを要求しないので、応答に混ざっても
  // state に入れてはいけない（トークン所有者の視聴状況が漏れる）。
  viewerStatusState: "WATCHING",
  image: {
    internalUrl: null,
    recommendedImageUrl: "https://annict.example/shared.jpg",
    facebookOgImageUrl: null,
    twitterBiggerAvatarUrl: null,
    twitterAvatarUrl: null,
    twitterNormalAvatarUrl: null,
    twitterMiniAvatarUrl: null,
  },
  staffs: { nodes: [] },
  casts: {
    nodes: [
      {
        annictId: 1,
        sortNumber: 1,
        person: { annictId: 11, name: "声優" },
        character: {
          annictId: 21,
          name: "キャラ",
          nameKana: null,
          nameEn: null,
        },
      },
    ],
  },
};

type AnnictCall = { authorization: string | null; query: string };

// Annict GraphQL を模擬し、送られた Authorization とクエリを記録する。
function mockAnnict(status = 200): { calls: AnnictCall[] } {
  const calls: AnnictCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body = JSON.parse(init?.body as string) as { query: string };
    calls.push({
      authorization: new Headers(init?.headers).get("Authorization"),
      query: body.query,
    });
    if (status !== 200) return new Response("error", { status });
    return new Response(
      JSON.stringify({
        data: {
          searchWorks: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [WORK_NODE],
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  return { calls };
}

describe("共用トークンでの作品情報取得（issue #561）", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    vi.restoreAllMocks();
    vi.mocked(getAuth).mockReset();
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
    } as ReturnType<typeof getAuth>);
    await caches.default.delete(titleSearchCacheUrl(SEARCH_TITLE, null));
    await caches.default.delete(sharedWorkDetailCacheUrl(WORK_ID));
  });

  describe("GET /works/catalog-status", () => {
    it("共用トークンが設定されていれば sharedCatalogAvailable: true（値は返さない）", async () => {
      const res = await buildApp().request(
        "/works/catalog-status",
        {},
        SHARED_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ sharedCatalogAvailable: true });
      expect(body).not.toContain(SHARED_TOKEN);
    });

    it("未設定・空白だけなら sharedCatalogAvailable: false", async () => {
      for (const bindings of [
        BASE_BINDINGS,
        { ...BASE_BINDINGS, ANNICT_SHARED_READ_TOKEN: "  " },
      ]) {
        const res = await buildApp().request(
          "/works/catalog-status",
          {},
          bindings,
        );
        expect(await res.json()).toEqual({ sharedCatalogAvailable: false });
      }
    });
  });

  it("本人のトークンが無ければ共用トークンでタイトル検索する", async () => {
    const { calls } = mockAnnict();
    const res = await buildApp().request(
      `/works/search?title=${encodeURIComponent(SEARCH_TITLE)}`,
      {},
      SHARED_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { works: { annictWorkId: number }[] };
    expect(body.works.map((w) => w.annictWorkId)).toEqual([WORK_ID]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.authorization).toBe(`Bearer ${SHARED_TOKEN}`);
  });

  it("本人のトークンがあれば共用トークンより優先する", async () => {
    const { calls } = mockAnnict();
    const res = await buildApp().request(
      `/works/search?title=${encodeURIComponent(SEARCH_TITLE)}`,
      { headers: { "X-Annict-Token": "tok_user" } },
      SHARED_BINDINGS,
    );

    expect(res.status).toBe(200);
    expect(calls[0]?.authorization).toBe("Bearer tok_user");
  });

  it("共用トークンも本人のトークンも無ければ従来どおり 401 annict_token_required", async () => {
    const res = await buildApp().request(
      `/works/search?title=${encodeURIComponent(SEARCH_TITLE)}`,
      {},
      BASE_BINDINGS,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "annict_token_required" });
  });

  it("同じタイトルの検索は短期キャッシュから返し Annict を再度呼ばない", async () => {
    const { calls } = mockAnnict();
    const app = buildApp();
    for (const title of [SEARCH_TITLE, ` ${SEARCH_TITLE} `]) {
      const res = await app.request(
        `/works/search?title=${encodeURIComponent(title)}`,
        {},
        SHARED_BINDINGS,
      );
      expect(res.status).toBe(200);
    }
    expect(calls).toHaveLength(1);
  });

  describe("GET /works/:id", () => {
    it("共用トークンでは視聴ステータスを問い合わせず state は null", async () => {
      const { calls } = mockAnnict();
      const res = await buildApp().request(
        `/works/${WORK_ID}`,
        {},
        SHARED_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        work: { annictWorkId: number; state: string | null };
      };
      expect(body.work).toMatchObject({ annictWorkId: WORK_ID, state: null });
      expect(calls[0]?.authorization).toBe(`Bearer ${SHARED_TOKEN}`);
      expect(calls[0]?.query).not.toMatch(/viewer/i);
    });

    it("共用トークンの詳細はキャッシュし、2 回目は Annict を呼ばない", async () => {
      const { calls } = mockAnnict();
      const app = buildApp();
      await app.request(`/works/${WORK_ID}`, {}, SHARED_BINDINGS);
      const res = await app.request(`/works/${WORK_ID}`, {}, SHARED_BINDINGS);

      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
    });

    it("本人のトークンの詳細は視聴ステータスを含むためキャッシュしない", async () => {
      const { calls } = mockAnnict();
      const app = buildApp();
      const headers = { "X-Annict-Token": "tok_user" };
      await app.request(`/works/${WORK_ID}`, { headers }, SHARED_BINDINGS);
      const res = await app.request(
        `/works/${WORK_ID}`,
        { headers },
        SHARED_BINDINGS,
      );

      const body = (await res.json()) as { work: { state: string | null } };
      expect(body.work.state).toBe("WATCHING");
      expect(calls).toHaveLength(2);
      expect(calls[0]?.query).toContain("viewerStatusState");
    });
  });

  it("GET /works/:id/characters: 共用トークンでキャラクター一覧を返す", async () => {
    const { calls } = mockAnnict();
    const res = await buildApp().request(
      `/works/${WORK_ID}/characters`,
      {},
      SHARED_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      characters: { annictCharacterId: number }[];
    };
    expect(body.characters.map((c) => c.annictCharacterId)).toEqual([21]);
    expect(calls[0]?.authorization).toBe(`Bearer ${SHARED_TOKEN}`);
  });

  it("GET /works/lookup: キャッシュに無い作品を共用トークンで引く", async () => {
    const { calls } = mockAnnict();
    const res = await buildApp().request(
      `/works/lookup?ids=${WORK_ID}`,
      {},
      SHARED_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { works: { annictWorkId: number }[] };
    expect(body.works.map((w) => w.annictWorkId)).toEqual([WORK_ID]);
    expect(calls[0]?.authorization).toBe(`Bearer ${SHARED_TOKEN}`);
  });

  it("共用トークンが Annict に拒否されたら 503 annict_shared_token_unavailable", async () => {
    mockAnnict(401);
    const res = await buildApp().request(
      `/works/search?title=${encodeURIComponent(SEARCH_TITLE)}`,
      {},
      SHARED_BINDINGS,
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: "annict_shared_token_unavailable",
    });
  });

  it("Annict のレート制限は 429 annict_rate_limited", async () => {
    mockAnnict(429);
    const res = await buildApp().request(
      `/works/search?title=${encodeURIComponent(SEARCH_TITLE)}`,
      {},
      SHARED_BINDINGS,
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "annict_rate_limited" });
  });
});
