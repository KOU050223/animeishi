import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { share } from "@/features/share";
import {
  annictCharacters,
  annictWorks,
  tierListItems,
  tierLists,
  users,
} from "@/db/schema";

const OWNER_ID = "user_share_html_owner";
const WORK_A = 1001;
const WORK_B = 1002;
const CHAR_A = 2001;
const CHAR_B = 2002;
const NOW = new Date("2026-01-02T03:04:05.000Z");
const TIERS_JSON = JSON.stringify([
  { key: "s", label: "S", color: "#ff7f7f" },
  { key: "a", label: "A", color: "#60a5fa" },
]);

type TestEnv = {
  Bindings: {
    DB: D1Database;
    PUBLIC_WEB_URL?: string;
  };
};

const TEST_BINDINGS = {
  DB: env.DB,
};

function buildApp() {
  const app = new Hono<TestEnv>();
  app.route("/share", share);
  return app;
}

let db: Awaited<ReturnType<typeof setupTestDb>>;

async function insertSharedTierList(
  list: typeof tierLists.$inferInsert,
  items: (typeof tierListItems.$inferInsert)[],
) {
  await db.insert(tierLists).values(list);
  await db.insert(tierListItems).values(items);
}

async function getSharedHtml(
  token: string,
  options: { requestOrigin?: string; publicWebUrl?: string } = {},
): Promise<string> {
  const app = buildApp();
  const bindings = options.publicWebUrl
    ? { ...TEST_BINDINGS, PUBLIC_WEB_URL: options.publicWebUrl }
    : TEST_BINDINGS;
  const res = await app.request(
    `${options.requestOrigin ?? ""}/share/tier-lists/${token}`,
    { method: "GET", headers: { Accept: "text/html" } },
    bindings,
  );
  expect(res.status).toBe(200);
  return res.text();
}

function expectOgp(html: string): void {
  expect(html).toContain('property="og:title"');
  expect(html).toContain('property="og:description"');
  expect(html).toContain('property="og:url"');
  expect(html).toContain('property="og:image"');
}

describe("tier 表共有ページ HTML の固定", () => {
  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    await db.insert(users).values({
      id: OWNER_ID,
      username: "tier-owner",
      isPublic: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(annictWorks).values([
      {
        annictWorkId: WORK_A,
        title: "作品A",
        imageUrl: "https://images.example.com/work-a-annict.jpg",
        resolvedImageUrl: "https://images.example.com/work-a-resolved.jpg",
        updatedAt: NOW,
      },
      {
        annictWorkId: WORK_B,
        title: "作品B",
        updatedAt: NOW,
      },
    ]);
    await db.insert(annictCharacters).values([
      {
        annictCharacterId: CHAR_A,
        name: "キャラA",
        imageUrl: "https://images.example.com/chara-a.png",
        updatedAt: NOW,
      },
      {
        annictCharacterId: CHAR_B,
        name: "キャラB",
        updatedAt: NOW,
      },
    ]);
  });

  it("シーズン tier 表の共有ページ（OGP を含む）を固定する", async () => {
    await insertSharedTierList(
      {
        id: 101,
        userId: OWNER_ID,
        kind: "season",
        season: "2026-spring",
        title: "2026春アニメ Tier",
        description: "春の注目作を並べた表",
        tiersJson: TIERS_JSON,
        shareToken: "season-share-token",
        createdAt: NOW,
        updatedAt: NOW,
      },
      [
        {
          tierListId: 101,
          annictWorkId: WORK_A,
          tierKey: "s",
          position: 0,
        },
        {
          tierListId: 101,
          annictWorkId: WORK_B,
          tierKey: "a",
          position: 0,
        },
      ],
    );

    const html = await getSharedHtml("season-share-token");

    expectOgp(html);
    expect(html).toMatchSnapshot();
  });

  it("自由作成 tier 表の共有ページ（OGP を含む）を固定する", async () => {
    await insertSharedTierList(
      {
        id: 102,
        userId: OWNER_ID,
        kind: "custom",
        title: "歴代で好きなアニメ",
        description: "年代をまたいで選んだ表",
        tiersJson: TIERS_JSON,
        shareToken: "custom-share-token",
        createdAt: NOW,
        updatedAt: NOW,
      },
      [
        {
          tierListId: 102,
          annictWorkId: WORK_A,
          tierKey: "s",
          position: 0,
        },
        {
          tierListId: 102,
          annictWorkId: WORK_B,
          tierKey: "a",
          position: 0,
        },
      ],
    );

    const html = await getSharedHtml("custom-share-token");

    expectOgp(html);
    expect(html).toMatchSnapshot();
  });

  it("作品画像はリクエストオリジン、登録リンクは Web オリジンを使う", async () => {
    await insertSharedTierList(
      {
        id: 104,
        userId: OWNER_ID,
        kind: "season",
        season: "2026-spring",
        title: "オリジン確認用の表",
        description: null,
        tiersJson: TIERS_JSON,
        shareToken: "season-origin-token",
        createdAt: NOW,
        updatedAt: NOW,
      },
      [
        {
          tierListId: 104,
          annictWorkId: WORK_A,
          tierKey: "s",
          position: 0,
        },
      ],
    );

    const html = await getSharedHtml("season-origin-token", {
      requestOrigin: "https://api.example.com",
      publicWebUrl: "https://web.example.com",
    });

    expect(html).toContain('src="https://api.example.com/images/works/1001"');
    expect(html).toContain(
      'href="https://web.example.com/sign-up?from=share_tier_list"',
    );
  });

  it("キャラクター tier 表の共有ページ（OGP を含む）を固定する", async () => {
    await insertSharedTierList(
      {
        id: 103,
        userId: OWNER_ID,
        kind: "character",
        annictWorkId: WORK_A,
        title: "作品Aのキャラ Tier",
        description: "好きなキャラクターを並べた表",
        tiersJson: TIERS_JSON,
        shareToken: "character-share-token",
        createdAt: NOW,
        updatedAt: NOW,
      },
      [
        {
          tierListId: 103,
          annictCharacterId: CHAR_A,
          tierKey: "s",
          position: 0,
        },
        {
          tierListId: 103,
          annictCharacterId: CHAR_B,
          tierKey: "a",
          position: 0,
        },
      ],
    );

    const html = await getSharedHtml("character-share-token");

    expectOgp(html);
    expect(html).toMatchSnapshot();
  });
});
