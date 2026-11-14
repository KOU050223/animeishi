import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { publicTierListsRoute } from "@/features/public-tier-lists";
import { usersRoute } from "@/features/users";
import {
  users,
  annictWorks,
  annictCharacters,
  tierLists,
  tierListItems,
  characterTierLists,
  characterTierListItems,
  customTierLists,
  customTierListItems,
  tierListLikes,
  blocks,
} from "@/db/schema";
import type { TierListKind } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testpubtl1";
const OTHER_USER_ID = "user_testpubtl2";
const THIRD_USER_ID = "user_testpubtl3";
const WORK_A = 3001;
const WORK_B = 3002;
const CHAR_A = 9001;
const CHAR_B = 9002;

const TIERS_JSON = JSON.stringify([
  { key: "s", label: "S", color: "#FF0000" },
  { key: "a", label: "A", color: "#00FF00" },
]);

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
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/tier-lists", publicTierListsRoute);
  app.route("/users", usersRoute);
  return app;
}

function jsonBody(method: "POST" | "PUT", body?: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

function asUser(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

type Db = Awaited<ReturnType<typeof setupTestDb>>;

async function insertSeasonList(
  db: Db,
  input: {
    userId: string;
    title: string;
    isPublic?: boolean;
    season?: string;
    createdAt?: Date;
    items?: { annictWorkId: number; tierKey?: string }[];
  },
) {
  const now = input.createdAt ?? new Date();
  const [row] = await db
    .insert(tierLists)
    .values({
      userId: input.userId,
      season: input.season ?? "2026-spring",
      title: input.title,
      tiersJson: TIERS_JSON,
      isPublic: input.isPublic ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: tierLists.id });
  for (const [i, item] of (input.items ?? []).entries()) {
    await db.insert(tierListItems).values({
      tierListId: row!.id,
      annictWorkId: item.annictWorkId,
      tierKey: item.tierKey ?? "s",
      position: i,
    });
  }
  return row!.id;
}

async function insertCharacterList(
  db: Db,
  input: {
    userId: string;
    title: string;
    isPublic?: boolean;
    annictWorkId?: number;
    createdAt?: Date;
    items?: { annictCharacterId: number; tierKey?: string }[];
  },
) {
  const now = input.createdAt ?? new Date();
  const [row] = await db
    .insert(characterTierLists)
    .values({
      userId: input.userId,
      annictWorkId: input.annictWorkId ?? WORK_A,
      title: input.title,
      tiersJson: TIERS_JSON,
      isPublic: input.isPublic ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: characterTierLists.id });
  for (const [i, item] of (input.items ?? []).entries()) {
    await db.insert(characterTierListItems).values({
      characterTierListId: row!.id,
      annictCharacterId: item.annictCharacterId,
      tierKey: item.tierKey ?? "s",
      position: i,
    });
  }
  return row!.id;
}

async function insertCustomList(
  db: Db,
  input: {
    userId: string;
    title: string;
    isPublic?: boolean;
    createdAt?: Date;
    items?: { annictWorkId: number; tierKey?: string }[];
  },
) {
  const now = input.createdAt ?? new Date();
  const [row] = await db
    .insert(customTierLists)
    .values({
      userId: input.userId,
      title: input.title,
      tiersJson: TIERS_JSON,
      isPublic: input.isPublic ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: customTierLists.id });
  for (const [i, item] of (input.items ?? []).entries()) {
    await db.insert(customTierListItems).values({
      customTierListId: row!.id,
      annictWorkId: item.annictWorkId,
      tierKey: item.tierKey ?? "s",
      position: i,
    });
  }
  return row!.id;
}

async function getPublic(app: ReturnType<typeof buildApp>, query = "") {
  return app.request(
    `/tier-lists/public${query}`,
    { method: "GET" },
    TEST_BINDINGS,
  );
}

type PublicListItem = {
  kind: TierListKind;
  id: number;
  title: string;
  season: string | null;
  workTitle: string | null;
  likeCount: number;
  likedByMe: boolean;
  itemCount: number;
  owner: { userId: string; username: string };
  thumbnails: { url: string; label: string }[];
};

describe("公開 Tier 表 API", () => {
  let db: Db;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    const now = new Date();
    await db.insert(users).values([
      {
        id: USER_ID,
        username: "見る側ユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: OTHER_USER_ID,
        username: "リスト所有者",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: THIRD_USER_ID,
        username: "3人目",
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
      {
        annictCharacterId: CHAR_A,
        name: "キャラA",
        imageUrl: "https://example.com/char-a.png",
        updatedAt: now,
      },
      { annictCharacterId: CHAR_B, name: "キャラB", updatedAt: now },
    ]);
  });

  describe("認証なし", () => {
    it("GET /tier-lists/public: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const res = await getPublic(buildApp());
      expect(res.status).toBe(401);
    });
  });

  describe("GET /tier-lists/public", () => {
    beforeEach(() => asUser(USER_ID));

    it("3 種類の公開リストが種別つきで混ざって返る", async () => {
      const app = buildApp();
      await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "シーズン表",
        items: [{ annictWorkId: WORK_A }],
      });
      await insertCharacterList(db, {
        userId: OTHER_USER_ID,
        title: "キャラ表",
        items: [{ annictCharacterId: CHAR_A }],
      });
      await insertCustomList(db, {
        userId: OTHER_USER_ID,
        title: "自由表",
        items: [{ annictWorkId: WORK_B }],
      });

      const res = await getPublic(app);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: PublicListItem[] };
      expect(body.items.map((i) => i.kind).sort()).toEqual([
        "character",
        "custom",
        "season",
      ]);
      const season = body.items.find((i) => i.kind === "season");
      expect(season?.title).toBe("シーズン表");
      expect(season?.season).toBe("2026-spring");
      expect(season?.owner.username).toBe("リスト所有者");
      expect(season?.itemCount).toBe(1);
      const character = body.items.find((i) => i.kind === "character");
      expect(character?.workTitle).toBe("アニメA");
    });

    it("サムネイルは作品はプロキシ URL・キャラは imageUrl で返り、代替表示用の label を持つ", async () => {
      const app = buildApp();
      await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "シーズン表",
        items: [{ annictWorkId: WORK_A }],
      });
      await insertCharacterList(db, {
        userId: OTHER_USER_ID,
        title: "キャラ表",
        items: [{ annictCharacterId: CHAR_A }],
      });
      await insertCharacterList(db, {
        userId: OTHER_USER_ID,
        title: "画像なしキャラ表",
        annictWorkId: WORK_B,
        items: [{ annictCharacterId: CHAR_B }],
      });

      const res = await getPublic(app);
      const body = (await res.json()) as { items: PublicListItem[] };
      const season = body.items.find((i) => i.kind === "season");
      expect(season?.thumbnails).toEqual([
        expect.objectContaining({
          url: expect.stringContaining(`/images/works/${WORK_A}`),
          label: "アニメA",
        }),
      ]);
      const character = body.items.find(
        (i) => i.kind === "character" && i.title === "キャラ表",
      );
      expect(character?.thumbnails).toEqual([
        { url: "https://example.com/char-a.png", label: "キャラA" },
      ]);
      const noImage = body.items.find((i) => i.title === "画像なしキャラ表");
      expect(noImage?.thumbnails).toEqual([]);
    });

    it("非公開リストと非公開オーナーのリストは出ない", async () => {
      const app = buildApp();
      await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "非公開表",
        isPublic: false,
      });
      await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "公開表",
        season: "2025-spring",
      });
      await db
        .update(users)
        .set({ isPublic: false })
        .where(eq(users.id, OTHER_USER_ID));
      await insertCustomList(db, {
        userId: THIRD_USER_ID,
        title: "3人目の公開表",
      });

      const res = await getPublic(app);
      const body = (await res.json()) as { items: PublicListItem[] };
      expect(body.items.map((i) => i.title)).toEqual(["3人目の公開表"]);
    });

    it("ブロック関係（自分→相手 / 相手→自分）のリストは出ない", async () => {
      const app = buildApp();
      await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "ブロック相手の表",
      });
      await insertCustomList(db, {
        userId: THIRD_USER_ID,
        title: "相手からブロックされている人の表",
      });
      const now = new Date();
      await db.insert(blocks).values({
        blockerId: USER_ID,
        blockedId: OTHER_USER_ID,
        createdAt: now,
      });
      await db.insert(blocks).values({
        blockerId: THIRD_USER_ID,
        blockedId: USER_ID,
        createdAt: now,
      });

      const res = await getPublic(app);
      const body = (await res.json()) as { items: PublicListItem[] };
      expect(body.items).toHaveLength(0);
    });

    it("sort=likes: いいね数の多い順。同数は kind→id の決定的な順でカーソルが回る", async () => {
      const app = buildApp();
      const seasonId = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "シーズン",
      });
      const characterId = await insertCharacterList(db, {
        userId: OTHER_USER_ID,
        title: "キャラ",
      });
      const customId = await insertCustomList(db, {
        userId: OTHER_USER_ID,
        title: "自由",
      });
      const now = new Date();
      // シーズンに 1 いいね。キャラ・自由は 0 で同率。
      await db.insert(tierListLikes).values({
        userId: USER_ID,
        listKind: "season",
        listId: seasonId,
        createdAt: now,
      });

      const page1 = await getPublic(app, "?sort=likes&limit=2");
      const body1 = (await page1.json()) as {
        items: PublicListItem[];
        nextCursor: string | null;
      };
      // season(1 いいね) → custom → character（0 同率は rank 降順）
      expect(body1.items.map((i) => [i.kind, i.id] as const)).toEqual([
        ["season", seasonId],
        ["custom", customId],
      ]);
      expect(body1.items[0]?.likedByMe).toBe(true);
      expect(body1.nextCursor).not.toBeNull();

      const page2 = await getPublic(
        app,
        `?sort=likes&limit=2&cursor=${body1.nextCursor}`,
      );
      const body2 = (await page2.json()) as {
        items: PublicListItem[];
        nextCursor: string | null;
      };
      expect(body2.items.map((i) => [i.kind, i.id] as const)).toEqual([
        ["character", characterId],
      ]);
      expect(body2.nextCursor).toBeNull();
    });

    it("sort=new: 新しい順に返り、cursor で次ページを取れる", async () => {
      const app = buildApp();
      const t1 = new Date("2026-01-01T00:00:00Z");
      const t2 = new Date("2026-01-02T00:00:00Z");
      const t3 = new Date("2026-01-03T00:00:00Z");
      const customId = await insertCustomList(db, {
        userId: OTHER_USER_ID,
        title: "一番古い自由表",
        createdAt: t1,
      });
      const seasonId = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "真ん中のシーズン表",
        createdAt: t2,
      });
      const characterId = await insertCharacterList(db, {
        userId: OTHER_USER_ID,
        title: "最新のキャラ表",
        createdAt: t3,
      });

      const page1 = await getPublic(app, "?sort=new&limit=2");
      const body1 = (await page1.json()) as {
        items: PublicListItem[];
        nextCursor: string | null;
      };
      expect(body1.items.map((i) => [i.kind, i.id] as const)).toEqual([
        ["character", characterId],
        ["season", seasonId],
      ]);

      const page2 = await getPublic(
        app,
        `?sort=new&limit=2&cursor=${body1.nextCursor}`,
      );
      const body2 = (await page2.json()) as {
        items: PublicListItem[];
        nextCursor: string | null;
      };
      expect(body2.items.map((i) => [i.kind, i.id] as const)).toEqual([
        ["custom", customId],
      ]);
      expect(body2.nextCursor).toBeNull();
    });

    it("不正な sort / cursor は 400 を返す", async () => {
      const app = buildApp();
      expect((await getPublic(app, "?sort=popular")).status).toBe(400);
      expect((await getPublic(app, "?cursor=abc")).status).toBe(400);
      // kind 順位なしの 2 連 cursor も受け付けない
      expect((await getPublic(app, "?cursor=1_2")).status).toBe(400);
    });
  });

  describe("GET /tier-lists/:kind/:id", () => {
    beforeEach(() => asUser(USER_ID));

    it("シーズン表の詳細を tiers と配置作品つきで返す", async () => {
      const app = buildApp();
      const id = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "詳細を見たい表",
        items: [
          { annictWorkId: WORK_A, tierKey: "s" },
          { annictWorkId: WORK_B, tierKey: "a" },
        ],
      });
      asUser(THIRD_USER_ID);
      await app.request(
        `/tier-lists/season/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      asUser(USER_ID);

      const res = await app.request(
        `/tier-lists/season/${id}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        kind: string;
        title: string;
        season: string;
        owner: { userId: string };
        likeCount: number;
        tiers: { key: string; label: string }[];
        items: {
          kind: string;
          annictWorkId: number;
          tierKey: string;
          title: string;
          hostedImageUrl: string;
        }[];
      };
      expect(body.kind).toBe("season");
      expect(body.title).toBe("詳細を見たい表");
      expect(body.season).toBe("2026-spring");
      expect(body.owner.userId).toBe(OTHER_USER_ID);
      expect(body.likeCount).toBe(1);
      expect(body.tiers.map((t) => t.key)).toEqual(["s", "a"]);
      expect(body.items).toHaveLength(2);
      expect(body.items[0]?.kind).toBe("work");
      expect(body.items[0]?.title).toBe("アニメA");
      expect(body.items[0]?.hostedImageUrl).toContain(
        `/images/works/${WORK_A}`,
      );
    });

    it("キャラ表の詳細はキャラクター items と対象作品名を返す", async () => {
      const app = buildApp();
      const id = await insertCharacterList(db, {
        userId: OTHER_USER_ID,
        title: "キャラ表",
        items: [{ annictCharacterId: CHAR_A }],
      });

      const res = await app.request(
        `/tier-lists/character/${id}`,
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        kind: string;
        workTitle: string;
        items: {
          kind: string;
          annictCharacterId: number;
          name: string;
          imageUrl: string | null;
        }[];
      };
      expect(body.kind).toBe("character");
      expect(body.workTitle).toBe("アニメA");
      expect(body.items[0]?.kind).toBe("character");
      expect(body.items[0]?.name).toBe("キャラA");
      expect(body.items[0]?.imageUrl).toBe("https://example.com/char-a.png");
    });

    it("未公開・ブロック関係・非公開オーナー・未存在・不正 kind は 404/400", async () => {
      const app = buildApp();
      const privateId = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "非公開",
        isPublic: false,
      });
      const publicId = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "公開",
        season: "2025-spring",
      });

      expect(
        (
          await app.request(
            `/tier-lists/season/${privateId}`,
            { method: "GET" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request(
            `/tier-lists/custom/99999`,
            { method: "GET" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
      // 不正 kind
      expect(
        (
          await app.request(
            `/tier-lists/unknown/${publicId}`,
            { method: "GET" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(400);

      // ブロック関係
      await db.insert(blocks).values({
        blockerId: USER_ID,
        blockedId: OTHER_USER_ID,
        createdAt: new Date(),
      });
      expect(
        (
          await app.request(
            `/tier-lists/season/${publicId}`,
            { method: "GET" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);

      // 所有者非公開
      await db.delete(blocks);
      await db
        .update(users)
        .set({ isPublic: false })
        .where(eq(users.id, OTHER_USER_ID));
      expect(
        (
          await app.request(
            `/tier-lists/season/${publicId}`,
            { method: "GET" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe("いいね", () => {
    beforeEach(() => asUser(USER_ID));

    it("PUT /:kind/:id/like: 公開リストにいいねでき、likeCount が増える", async () => {
      const app = buildApp();
      const id = await insertCustomList(db, {
        userId: OTHER_USER_ID,
        title: "自由表",
      });

      const res = await app.request(
        `/tier-lists/custom/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ likeCount: 1, likedByMe: true });
    });

    it("PUT /:kind/:id/like: 同じリストへの再いいねは no-op（冪等）", async () => {
      const app = buildApp();
      const id = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "表",
      });

      await app.request(
        `/tier-lists/season/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      const res = await app.request(
        `/tier-lists/season/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ likeCount: 1, likedByMe: true });
    });

    it("PUT /:kind/:id/like: 自分のリストにはいいねできない（400）", async () => {
      const app = buildApp();
      const id = await insertSeasonList(db, {
        userId: USER_ID,
        title: "自分の表",
      });

      const res = await app.request(
        `/tier-lists/season/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("PUT /:kind/:id/like: 未公開・ブロック関係・未存在は 404", async () => {
      const app = buildApp();
      const privateId = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "非公開",
        isPublic: false,
      });
      const publicId = await insertCharacterList(db, {
        userId: OTHER_USER_ID,
        title: "公開",
      });
      await db.insert(blocks).values({
        blockerId: USER_ID,
        blockedId: OTHER_USER_ID,
        createdAt: new Date(),
      });

      expect(
        (
          await app.request(
            `/tier-lists/season/${privateId}/like`,
            { method: "PUT" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request(
            `/tier-lists/character/${publicId}/like`,
            { method: "PUT" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request(
            `/tier-lists/season/99999/like`,
            { method: "PUT" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
    });

    it("DELETE /:kind/:id/like: いいねを取り消せ、未いいねでも成功する（冪等）", async () => {
      const app = buildApp();
      const id = await insertCharacterList(db, {
        userId: OTHER_USER_ID,
        title: "キャラ表",
      });

      await app.request(
        `/tier-lists/character/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      const res = await app.request(
        `/tier-lists/character/${id}/like`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ likeCount: 0, likedByMe: false });

      const again = await app.request(
        `/tier-lists/character/${id}/like`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(again.status).toBe(200);
    });

    it("DELETE /:kind/:id/like: 見えないリストは 404（いいね数を漏らさない）", async () => {
      const app = buildApp();
      const id = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "表",
      });
      const privateId = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "非公開表",
        season: "2025-spring",
        isPublic: false,
      });

      expect(
        (
          await app.request(
            `/tier-lists/season/${privateId}/like`,
            { method: "DELETE" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);

      // 公開時にいいねしたあとで非公開化されても 404。
      await app.request(
        `/tier-lists/season/${id}/like`,
        { method: "PUT" },
        TEST_BINDINGS,
      );
      await db
        .update(tierLists)
        .set({ isPublic: false })
        .where(eq(tierLists.id, id));
      expect(
        (
          await app.request(
            `/tier-lists/season/${id}/like`,
            { method: "DELETE" },
            TEST_BINDINGS,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe("Tier 表の通報", () => {
    beforeEach(() => asUser(USER_ID));

    it("POST /:kind/:id/report: 公開リストを通報でき、kind と id が記録される", async () => {
      const app = buildApp();
      const id = await insertCharacterList(db, {
        userId: OTHER_USER_ID,
        title: "キャラ表",
      });

      const res = await app.request(
        `/tier-lists/character/${id}/report`,
        jsonBody("POST", { reason: "不適切なコンテンツ" }),
        TEST_BINDINGS,
      );
      expect(res.status).toBe(201);

      const stored = await db.query.reports.findFirst({
        where: (t, { eq: eq_ }) => eq_(t.reporterId, USER_ID),
      });
      expect(stored?.reportedUserId).toBe(OTHER_USER_ID);
      expect(stored?.reportedTierListKind).toBe("character");
      expect(stored?.reportedTierListId).toBe(id);
    });

    it("POST /:kind/:id/report: 自分のリストは通報できない（400）", async () => {
      const app = buildApp();
      const id = await insertCustomList(db, {
        userId: USER_ID,
        title: "自分の表",
      });

      const res = await app.request(
        `/tier-lists/custom/${id}/report`,
        jsonBody("POST", { reason: "理由" }),
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("POST /:kind/:id/report: 未公開リストは 404", async () => {
      const app = buildApp();
      const id = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "非公開",
        isPublic: false,
      });

      const res = await app.request(
        `/tier-lists/season/${id}/report`,
        jsonBody("POST", { reason: "理由" }),
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("POST /:kind/:id/report: 同じリストへの再通報は 429（重複抑止）", async () => {
      const app = buildApp();
      const id = await insertSeasonList(db, {
        userId: OTHER_USER_ID,
        title: "表",
      });
      // 別種別のリストを同時に通報しても同ターゲット重複にならない
      const customId = await insertCustomList(db, {
        userId: OTHER_USER_ID,
        title: "自由表",
      });

      const first = await app.request(
        `/tier-lists/season/${id}/report`,
        jsonBody("POST", { reason: "理由" }),
        TEST_BINDINGS,
      );
      expect(first.status).toBe(201);

      const second = await app.request(
        `/tier-lists/season/${id}/report`,
        jsonBody("POST", { reason: "理由" }),
        TEST_BINDINGS,
      );
      expect(second.status).toBe(429);
      const body = (await second.json()) as { code: string };
      expect(body.code).toBe("duplicate_target");

      // ユーザー通報・別リスト通報は重複扱いにならない
      const userReport = await app.request(
        `/users/${OTHER_USER_ID}/report`,
        jsonBody("POST", { reason: "別の理由" }),
        TEST_BINDINGS,
      );
      expect(userReport.status).toBe(201);
      const otherReport = await app.request(
        `/tier-lists/custom/${customId}/report`,
        jsonBody("POST", { reason: "理由" }),
        TEST_BINDINGS,
      );
      expect(otherReport.status).toBe(201);
    });
  });
});
