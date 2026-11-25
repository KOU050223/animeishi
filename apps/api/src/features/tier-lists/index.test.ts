import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { tierListsRoute } from "@/features/tier-lists";
import {
  users,
  annictWorks,
  annictCharacters,
  annictWorkCasts,
  tierListLikes,
} from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testtier001";
const OTHER_USER_ID = "user_testtier002";
const SEASON = "2026-spring";
const WORK_A = 1001;
const WORK_B = 1002;
const CHAR_A = 2001;
const CHAR_B = 2002;

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

const TIERS = [
  { key: "s", label: "神", color: "#ff7f7f" },
  { key: "a", label: "強", color: "#ffbf7f" },
];

type TierListBody = {
  id: number;
  kind: string;
  season: string | null;
  annictWorkId: number | null;
  title: string;
  description: string | null;
  isPublic: boolean;
  shareToken: string | null;
  items: {
    kind: string;
    tierKey: string;
    annictWorkId?: number;
    annictCharacterId?: number;
    title?: string;
    name?: string;
    hostedImageUrl?: string | null;
  }[];
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/me/tier-lists", tierListsRoute);
  return app;
}

function jsonBody(method: "POST" | "PUT", body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function seasonBody(overrides?: Record<string, unknown>) {
  return {
    kind: "season",
    season: SEASON,
    title: "2026年春アニメ Tier",
    tiers: TIERS,
    items: [
      { annictWorkId: WORK_A, tierKey: "s" },
      { annictWorkId: WORK_B, tierKey: "a" },
    ],
    ...overrides,
  };
}

async function createSeasonList(app: ReturnType<typeof buildApp>) {
  const res = await app.request(
    "/me/tier-lists",
    jsonBody("POST", seasonBody()),
    TEST_BINDINGS,
  );
  return res;
}

describe("tier 表 API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    const now = new Date();
    await db.insert(users).values([
      {
        id: USER_ID,
        username: "テストユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: OTHER_USER_ID,
        username: "別ユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(annictWorks).values([
      { annictWorkId: WORK_A, title: "アニメA", updatedAt: now },
      { annictWorkId: WORK_B, title: "アニメB", updatedAt: now },
    ]);

    await db.insert(annictCharacters).values([
      { annictCharacterId: CHAR_A, name: "キャラA", updatedAt: now },
      { annictCharacterId: CHAR_B, name: "キャラB", updatedAt: now },
    ]);
    await db.insert(annictWorkCasts).values([
      {
        annictWorkId: WORK_A,
        annictCharacterId: CHAR_A,
        sortNumber: 1,
      },
    ]);
  });

  describe("認証なし", () => {
    it("GET /me/tier-lists: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
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

    it("POST: season の tier 表を作成し、配置を作品メタ付きで返す", async () => {
      const app = buildApp();
      const res = await createSeasonList(app);

      expect(res.status).toBe(200);
      const body = (await res.json()) as TierListBody;
      expect(body.kind).toBe("season");
      expect(body.season).toBe(SEASON);
      expect(body.title).toBe("2026年春アニメ Tier");
      expect(body.items).toHaveLength(2);
      const sItem = body.items.find(
        (item: { tierKey: string }) => item.tierKey === "s",
      );
      expect(sItem?.kind).toBe("work");
      expect(sItem?.annictWorkId).toBe(WORK_A);
      expect(sItem?.title).toBe("アニメA");
      expect(sItem?.hostedImageUrl).toContain(`/images/works/${WORK_A}`);
    });

    it("POST: 同じシーズンへの再保存は upsert になり、古い配置は残らない", async () => {
      const app = buildApp();
      const first = await createSeasonList(app);
      const firstBody = (await first.json()) as TierListBody;

      const res = await app.request(
        "/me/tier-lists",
        jsonBody(
          "POST",
          seasonBody({
            title: "更新後のタイトル",
            items: [{ annictWorkId: WORK_B, tierKey: "s" }],
          }),
        ),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as TierListBody;
      // スコープキーでの upsert なので id は変わらない
      expect(body.id).toBe(firstBody.id);
      expect(body.title).toBe("更新後のタイトル");
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.annictWorkId).toBe(WORK_B);
    });

    it("POST: annict_works に無い作品は 400 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        jsonBody(
          "POST",
          seasonBody({ items: [{ annictWorkId: 999999, tierKey: "s" }] }),
        ),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { annictWorkIds: number[] };
      expect(body.annictWorkIds).toEqual([999999]);
    });

    it("POST: tiers に存在しない tierKey は 400 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        jsonBody(
          "POST",
          seasonBody({ items: [{ annictWorkId: WORK_A, tierKey: "x" }] }),
        ),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("POST: シーズン形式が不正なら 400 を返す", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        jsonBody("POST", seasonBody({ season: "spring-2026" })),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("POST: kind とスコープ値がずれていたら 400 を返す", async () => {
      const app = buildApp();
      const { season: _season, ...noSeason } = seasonBody();
      const missing = await app.request(
        "/me/tier-lists",
        jsonBody("POST", noSeason),
        TEST_BINDINGS,
      );
      expect(missing.status).toBe(400);

      const extra = await app.request(
        "/me/tier-lists",
        jsonBody("POST", seasonBody({ annictWorkId: WORK_A })),
        TEST_BINDINGS,
      );
      expect(extra.status).toBe(400);
    });

    it("POST: character の tier 表を作成できる（アイテムはキャストのみ）", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        jsonBody("POST", {
          kind: "character",
          annictWorkId: WORK_A,
          title: "キャラ Tier",
          tiers: TIERS,
          items: [{ annictCharacterId: CHAR_A, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as TierListBody;
      expect(body.kind).toBe("character");
      expect(body.annictWorkId).toBe(WORK_A);
      expect(body.items[0]?.kind).toBe("character");
      expect(body.items[0]?.name).toBe("キャラA");
    });

    it("POST: character の表にキャスト外のキャラクターは置けない", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        jsonBody("POST", {
          kind: "character",
          annictWorkId: WORK_A,
          title: "キャラ Tier",
          tiers: TIERS,
          items: [{ annictCharacterId: CHAR_B, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { annictCharacterIds: number[] };
      expect(body.annictCharacterIds).toEqual([CHAR_B]);
    });

    it("POST: character の表に作品アイテムは置けない", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/tier-lists",
        jsonBody("POST", {
          kind: "character",
          annictWorkId: WORK_A,
          title: "キャラ Tier",
          tiers: TIERS,
          items: [{ annictWorkId: WORK_A, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("POST: custom は毎回新規作成される", async () => {
      const app = buildApp();
      const body = {
        kind: "custom",
        title: "お気に入り",
        tiers: TIERS,
        items: [{ annictWorkId: WORK_A, tierKey: "s" }],
      };
      const first = await app.request(
        "/me/tier-lists",
        jsonBody("POST", body),
        TEST_BINDINGS,
      );
      const second = await app.request(
        "/me/tier-lists",
        jsonBody("POST", body),
        TEST_BINDINGS,
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const firstBody = (await first.json()) as TierListBody;
      const secondBody = (await second.json()) as TierListBody;
      expect(firstBody.id).not.toBe(secondBody.id);
      expect(firstBody.kind).toBe("custom");
    });

    it("GET: 自分の tier 表を一覧できる。kind / season で絞り込める", async () => {
      const app = buildApp();
      await createSeasonList(app);
      await app.request(
        "/me/tier-lists",
        jsonBody("POST", {
          kind: "custom",
          title: "お気に入り",
          tiers: TIERS,
          items: [],
        }),
        TEST_BINDINGS,
      );

      const all = await app.request("/me/tier-lists", {}, TEST_BINDINGS);
      expect(all.status).toBe(200);
      const allBody = (await all.json()) as TierListBody[];
      expect(allBody).toHaveLength(2);

      const customOnly = await app.request(
        "/me/tier-lists?kind=custom",
        {},
        TEST_BINDINGS,
      );
      const customBody = (await customOnly.json()) as TierListBody[];
      expect(customBody).toHaveLength(1);
      expect(customBody[0]?.kind).toBe("custom");

      const bySeason = await app.request(
        `/me/tier-lists?kind=season&season=${SEASON}`,
        {},
        TEST_BINDINGS,
      );
      const seasonLists = (await bySeason.json()) as TierListBody[];
      expect(seasonLists).toHaveLength(1);
      expect(seasonLists[0]?.season).toBe(SEASON);
    });

    it("GET /:id: 保存済みの表を配置ごと取得できる。未作成は 404", async () => {
      const app = buildApp();
      const created = (await (
        await createSeasonList(app)
      ).json()) as TierListBody;

      const res = await app.request(
        `/me/tier-lists/${created.id}`,
        {},
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as TierListBody;
      expect(body.items).toHaveLength(2);

      const missing = await app.request(
        "/me/tier-lists/99999",
        {},
        TEST_BINDINGS,
      );
      expect(missing.status).toBe(404);
    });

    it("PUT /:id: 表を丸ごと置き換える。他ユーザーの表は 404", async () => {
      const app = buildApp();
      const created = (await (
        await createSeasonList(app)
      ).json()) as TierListBody;

      const res = await app.request(
        `/me/tier-lists/${created.id}`,
        jsonBody("PUT", {
          title: "置き換え後",
          tiers: TIERS,
          items: [{ annictWorkId: WORK_B, tierKey: "s" }],
        }),
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as TierListBody;
      expect(body.title).toBe("置き換え後");
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.annictWorkId).toBe(WORK_B);

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      const other = await app.request(
        `/me/tier-lists/${created.id}`,
        jsonBody("PUT", { title: "乗っ取り", tiers: TIERS, items: [] }),
        TEST_BINDINGS,
      );
      expect(other.status).toBe(404);
    });

    it("DELETE /:id: 削除すると取得できなくなり、その表へのいいね行も消える", async () => {
      const app = buildApp();
      const created = (await (
        await createSeasonList(app)
      ).json()) as TierListBody;
      await db.insert(tierListLikes).values({
        userId: OTHER_USER_ID,
        tierListId: created.id,
        createdAt: new Date(),
      });

      const res = await app.request(
        `/me/tier-lists/${created.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const gone = await app.request(
        `/me/tier-lists/${created.id}`,
        {},
        TEST_BINDINGS,
      );
      expect(gone.status).toBe(404);
      const likes = await db.query.tierListLikes.findMany();
      expect(likes).toHaveLength(0);
    });

    it("他ユーザーの tier 表は見えない", async () => {
      const app = buildApp();
      await createSeasonList(app);

      vi.mocked(getAuth).mockReturnValue({
        userId: OTHER_USER_ID,
      } as ReturnType<typeof getAuth>);
      const res = await app.request("/me/tier-lists", {}, TEST_BINDINGS);
      const body = (await res.json()) as TierListBody[];
      expect(body).toHaveLength(0);
    });

    describe("説明文と公開設定（issue #476）", () => {
      it("POST: 省略時は非公開・説明なしで作成される", async () => {
        const app = buildApp();
        const res = await createSeasonList(app);
        const body = (await res.json()) as TierListBody;
        expect(body.isPublic).toBe(false);
        expect(body.description).toBeNull();
      });

      it("POST: 説明文と公開設定を保存できる", async () => {
        const app = buildApp();
        const res = await app.request(
          "/me/tier-lists",
          jsonBody(
            "POST",
            seasonBody({
              description: "今期の評価です",
              isPublic: true,
            }),
          ),
          TEST_BINDINGS,
        );
        const body = (await res.json()) as TierListBody;
        expect(body.description).toBe("今期の評価です");
        expect(body.isPublic).toBe(true);
      });

      it("PUT: 更新で省略した項目は既存値を維持し、空文字の説明文は消去される", async () => {
        const app = buildApp();
        const created = (await (
          await app.request(
            "/me/tier-lists",
            jsonBody(
              "POST",
              seasonBody({ description: "説明あり", isPublic: true }),
            ),
            TEST_BINDINGS,
          )
        ).json()) as TierListBody;

        const res = await app.request(
          `/me/tier-lists/${created.id}`,
          jsonBody("PUT", {
            title: "更新",
            tiers: TIERS,
            items: [],
            description: "",
          }),
          TEST_BINDINGS,
        );
        const body = (await res.json()) as TierListBody;
        expect(body.description).toBeNull();
        // isPublic を送らなかったので既存値（true）が維持される
        expect(body.isPublic).toBe(true);
      });
    });

    describe("共有", () => {
      it("POST /:id/share: 共有トークンを発行し、再発行は同じ値を返す", async () => {
        const app = buildApp();
        const created = (await (
          await createSeasonList(app)
        ).json()) as TierListBody;

        const res = await app.request(
          `/me/tier-lists/${created.id}/share`,
          { method: "POST" },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(200);
        const { shareToken } = (await res.json()) as { shareToken: string };
        expect(typeof shareToken).toBe("string");

        const again = await app.request(
          `/me/tier-lists/${created.id}/share`,
          { method: "POST" },
          TEST_BINDINGS,
        );
        const againBody = (await again.json()) as { shareToken: string };
        expect(againBody.shareToken).toBe(shareToken);
      });

      it("DELETE /:id/share: 共有をやめられる", async () => {
        const app = buildApp();
        const created = (await (
          await createSeasonList(app)
        ).json()) as TierListBody;
        await app.request(
          `/me/tier-lists/${created.id}/share`,
          { method: "POST" },
          TEST_BINDINGS,
        );

        const res = await app.request(
          `/me/tier-lists/${created.id}/share`,
          { method: "DELETE" },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(200);

        const list = await db.query.tierLists.findFirst();
        expect(list?.shareToken).toBeNull();
      });
    });

    describe("活動フィードへの記録", () => {
      it("POST: 新規作成時に活動（tier_list_created）を記録し、upsert では重複記録しない", async () => {
        const app = buildApp();
        await createSeasonList(app);
        await createSeasonList(app);

        const acts = await db.query.activities.findMany();
        const created = acts.filter((a) => a.type === "tier_list_created");
        expect(created).toHaveLength(1);
        expect(JSON.parse(created[0]!.meta ?? "{}")).toMatchObject({
          kind: "season",
          season: SEASON,
        });
      });

      it("POST /:id/share: 共有発行時に活動（tier_list_shared）を記録し、再発行では記録しない", async () => {
        const app = buildApp();
        const created = (await (
          await createSeasonList(app)
        ).json()) as TierListBody;

        await app.request(
          `/me/tier-lists/${created.id}/share`,
          { method: "POST" },
          TEST_BINDINGS,
        );
        await app.request(
          `/me/tier-lists/${created.id}/share`,
          { method: "POST" },
          TEST_BINDINGS,
        );

        const acts = await db.query.activities.findMany();
        const shared = acts.filter((a) => a.type === "tier_list_shared");
        expect(shared).toHaveLength(1);
      });
    });
  });
});
