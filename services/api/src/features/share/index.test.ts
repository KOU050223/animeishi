import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { tierLists } from "@/features/tier-lists";
import { share } from "@/features/share";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testshare001";
const SEASON = "2026-spring";
const WORK_A = 1001;
const WORK_B = 1002;
const WORK_EVIL = 1003;

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
  { key: "s", label: "S", color: "#ff7f7f" },
  { key: "a", label: "A", color: "#ffbf7f" },
];

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/share", share);
  app.route("/me/tier-lists", tierLists);
  return app;
}

function putBody(body: unknown) {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function seedTierList(app: ReturnType<typeof buildApp>) {
  return app.request(
    "/me/tier-lists",
    putBody({
      season: SEASON,
      title: "2026春のTier表",
      tiers: TIERS,
      items: [
        { annictWorkId: WORK_A, tierKey: "s" },
        { annictWorkId: WORK_B, tierKey: "a" },
      ],
    }),
    TEST_BINDINGS,
  );
}

describe("tier 表の共有", () => {
  beforeEach(async () => {
    const db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
    } as ReturnType<typeof getAuth>);

    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(annictWorks).values([
      {
        annictWorkId: WORK_A,
        title: "アニメA",
        resolvedImageUrl: "https://example.com/a.png",
        updatedAt: now,
      },
      { annictWorkId: WORK_B, title: "アニメB", updatedAt: now },
    ]);
  });

  it("POST /:season/share: そのシーズンの表が未作成なら 404 を返す", async () => {
    const app = buildApp();
    const res = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("POST /:season/share: トークンを発行し、再発行は同じトークンを返す", async () => {
    const app = buildApp();
    await seedTierList(app);

    const res1 = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    expect(res1.status).toBe(200);
    const { shareToken: token1 } = (await res1.json()) as {
      shareToken: string;
    };
    expect(token1).toBeTruthy();

    const res2 = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken: token2 } = (await res2.json()) as {
      shareToken: string;
    };
    expect(token2).toBe(token1);

    // GET /:season のレスポンスにも shareToken が含まれ、共有中か判別できる
    const getRes = await app.request(
      `/me/tier-lists/${SEASON}`,
      { method: "GET" },
      TEST_BINDINGS,
    );
    const saved = (await getRes.json()) as { shareToken: string | null };
    expect(saved.shareToken).toBe(token1);
  });

  it("POST /:season/share: 並行リクエストでも双方に同じトークンを返す", async () => {
    const app = buildApp();
    await seedTierList(app);

    // 双方が share_token = null を読んでから UPDATE する競合を再現する。
    // 条件付き UPDATE + 読み直しで、先に書いた側のトークンが後から
    // 上書きされてリンク切れになることを防ぐ。
    const [res1, res2] = await Promise.all([
      app.request(
        `/me/tier-lists/${SEASON}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      ),
      app.request(
        `/me/tier-lists/${SEASON}/share`,
        { method: "POST" },
        TEST_BINDINGS,
      ),
    ]);
    const { shareToken: token1 } = (await res1.json()) as {
      shareToken: string;
    };
    const { shareToken: token2 } = (await res2.json()) as {
      shareToken: string;
    };
    expect(token1).toBeTruthy();
    expect(token2).toBe(token1);

    // 返したトークンが実際に DB に残っている（公開取得できる）こと
    const publicRes = await app.request(
      `/share/tier-lists/${token1}`,
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(publicRes.status).toBe(200);
  });

  it("GET /share/tier-lists/:token: 認証なしで作品メタ付きの表を JSON 取得できる", async () => {
    const app = buildApp();
    await seedTierList(app);
    const shareRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    // getAuth を null にして認証なしを再現する
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );

    const res = await app.request(
      `/share/tier-lists/${shareToken}`,
      { method: "GET", headers: { Accept: "application/json" } },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title: string;
      season: string;
      tiers: { key: string; label: string; color: string }[];
      owner: { username: string };
      items: { annictWorkId: number; tierKey: string; title: string }[];
    };
    expect(body.title).toBe("2026春のTier表");
    expect(body.season).toBe(SEASON);
    expect(body.tiers).toEqual(TIERS);
    expect(body.owner.username).toBe("テストユーザー");
    expect(body.items).toEqual([
      expect.objectContaining({ annictWorkId: WORK_A, tierKey: "s" }),
      expect.objectContaining({ annictWorkId: WORK_B, tierKey: "a" }),
    ]);
  });

  it("GET /share/tier-lists/:token: 不明なトークンは 404 を返す", async () => {
    const app = buildApp();
    const res = await app.request(
      "/share/tier-lists/no-such-token",
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(404);
  });

  it("DELETE /:season/share: 解除すると公開取得が 404 になり、再発行で別トークンになる", async () => {
    const app = buildApp();
    await seedTierList(app);
    const shareRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken: token1 } = (await shareRes.json()) as {
      shareToken: string;
    };

    const delRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "DELETE" },
      TEST_BINDINGS,
    );
    expect(delRes.status).toBe(200);

    const publicRes = await app.request(
      `/share/tier-lists/${token1}`,
      { method: "GET" },
      TEST_BINDINGS,
    );
    expect(publicRes.status).toBe(404);

    const reshare = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken: token2 } = (await reshare.json()) as {
      shareToken: string;
    };
    expect(token2).not.toBe(token1);
  });

  it("GET /share/tier-lists/:token: Accept: text/html で OGP 付きの共有ページを返す", async () => {
    const app = buildApp();
    await seedTierList(app);
    const shareRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    const res = await app.request(
      `/share/tier-lists/${shareToken}`,
      { method: "GET", headers: { Accept: "text/html" } },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>2026春のTier表");
    expect(html).toContain('property="og:title"');
    // og:image には先頭の https 作品画像が入る（クローラは直接取得する）
    expect(html).toContain(
      'property="og:image" content="https://example.com/a.png"',
    );
    expect(html).toContain("アニメA");
    expect(html).toContain("アニメB");
    expect(html).toContain("テストユーザー");
    expect(html).toContain("https://example.com/a.png");
    // 共有ページは閲覧者のシステムスキームに追従する（issue #205）
    expect(html).toContain("prefers-color-scheme");
    // tier ラベルの文字色は行の背景色とのコントラストで決まる
    // （#ff7f7f は明るい側なので濃色文字）
    expect(html).toContain("background-color: #ff7f7f; color: #1f2937");
    // 共有解除後にキャッシュへ残らないよう、HTML は保存しない
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("GET /share/tier-lists/:token: 作品画像プロキシの URL が JSON/HTML に載る", async () => {
    const app = buildApp();
    await seedTierList(app);
    const shareRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    // JSON 応答: items の hostedImageUrl は作品単位のプロキシ URL
    const jsonRes = await app.request(
      `/share/tier-lists/${shareToken}`,
      { method: "GET", headers: { Accept: "application/json" } },
      TEST_BINDINGS,
    );
    const jsonBody = (await jsonRes.json()) as {
      items: { annictWorkId: number; hostedImageUrl: string | null }[];
    };
    expect(
      jsonBody.items.find((i) => i.annictWorkId === WORK_A)?.hostedImageUrl,
    ).toBe(`http://localhost/images/works/${WORK_A}`);
    expect(
      jsonBody.items.find((i) => i.annictWorkId === WORK_B)?.hostedImageUrl,
    ).toBe(`http://localhost/images/works/${WORK_B}`);

    // HTML 応答: <img> はプロキシ URL を最優先で使う
    const htmlRes = await app.request(
      `/share/tier-lists/${shareToken}`,
      { method: "GET", headers: { Accept: "text/html" } },
      TEST_BINDINGS,
    );
    const html = await htmlRes.text();
    expect(html).toContain(`src="http://localhost/images/works/${WORK_A}"`);
    // og:image は https を優先する既存仕様のため、テスト環境の
    // http://localhost なプロキシ URL より外部 https URL が選ばれる
    // （本番ではプロキシ URL が https のためそちらが優先される）。
    expect(html).toContain(
      'property="og:image" content="https://example.com/a.png"',
    );
  });

  it("GET /share/tier-lists/:token: http(s) 以外の画像 URL は HTML に出力しない", async () => {
    const app = buildApp();
    const db = await setupTestDb(env.DB);
    await db.insert(annictWorks).values({
      annictWorkId: WORK_EVIL,
      title: "悪意あるURLの作品",
      resolvedImageUrl: "javascript:alert(1)",
      updatedAt: new Date(),
    });
    await app.request(
      "/me/tier-lists",
      putBody({
        season: SEASON,
        title: "2026春のTier表",
        tiers: TIERS,
        items: [{ annictWorkId: WORK_EVIL, tierKey: "s" }],
      }),
      TEST_BINDINGS,
    );
    const shareRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    const res = await app.request(
      `/share/tier-lists/${shareToken}`,
      { method: "GET", headers: { Accept: "text/html" } },
      TEST_BINDINGS,
    );
    const html = await res.text();
    // タイトル自体は出るが、javascript: の src は吐かない
    expect(html).toContain("悪意あるURLの作品");
    expect(html).not.toContain("javascript:");
  });

  it("GET /share/tier-lists/:token: resolvedImageUrl が不安全なら imageUrl にフォールバックする", async () => {
    const app = buildApp();
    const db = await setupTestDb(env.DB);
    // resolved は真値だが http(s) ではない。imageUrl 側が有効な作品では
    // ページ上のポスター表示も og:image も imageUrl を使う。
    await db.insert(annictWorks).values({
      annictWorkId: WORK_EVIL,
      title: "フォールバック作品",
      resolvedImageUrl: "javascript:alert(1)",
      imageUrl: "https://cdn.example.com/poster.png",
      updatedAt: new Date(),
    });
    await app.request(
      "/me/tier-lists",
      putBody({
        season: SEASON,
        title: "2026春のTier表",
        tiers: TIERS,
        items: [{ annictWorkId: WORK_EVIL, tierKey: "s" }],
      }),
      TEST_BINDINGS,
    );
    const shareRes = await app.request(
      `/me/tier-lists/${SEASON}/share`,
      { method: "POST" },
      TEST_BINDINGS,
    );
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    const res = await app.request(
      `/share/tier-lists/${shareToken}`,
      { method: "GET", headers: { Accept: "text/html" } },
      TEST_BINDINGS,
    );
    const html = await res.text();
    // ポスター表示はプロキシ URL。プロキシが 404 のときに備えて、安全な
    // 外部 URL（不安全な resolved は飛ばして imageUrl）を切り替え先に載せる。
    expect(html).toContain(`src="http://localhost/images/works/${WORK_EVIL}"`);
    expect(html).toContain(
      'data-fallback="https://cdn.example.com/poster.png"',
    );
    expect(html).toContain(
      'property="og:image" content="https://cdn.example.com/poster.png"',
    );
    expect(html).not.toContain("javascript:");
  });
});

describe("GET /share/image-proxy", () => {
  const KNOWN_IMAGE_URL = "https://s4.anilist.co/a.png";
  const KNOWN_IMAGE_URL_2 = "https://cdn.myanimelist.net/b.jpg";

  beforeEach(async () => {
    const db = await setupTestDb(env.DB);
    vi.restoreAllMocks();
    const now = new Date();
    // プロキシは annict_works の画像カラムに実在する URL だけを中継する
    await db.insert(annictWorks).values([
      {
        annictWorkId: 9001,
        title: "画像A",
        imageUrl: KNOWN_IMAGE_URL,
        updatedAt: now,
      },
      {
        annictWorkId: 9002,
        title: "画像B",
        resolvedImageUrl: KNOWN_IMAGE_URL_2,
        updatedAt: now,
      },
    ]);
  });

  function buildProxyApp() {
    const app = applyApiErrorHandling(new Hono<TestEnv>());
    app.route("/share", share);
    return app;
  }

  it("url パラメータ必須。未指定は 400 を返す", async () => {
    const app = buildProxyApp();
    const res = await app.request("/share/image-proxy", {}, TEST_BINDINGS);
    expect(res.status).toBe(400);
  });

  it("https 以外のスキームは 400 を返す（http も拒否）", async () => {
    const app = buildProxyApp();
    for (const url of ["javascript:alert(1)", "http://example.com/x.png"]) {
      const res = await app.request(
        `/share/image-proxy?url=${encodeURIComponent(url)}`,
        {},
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    }
  });

  it("annict_works の画像カラムに無い URL は 403 を返す", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent("https://evil.example.com/x.png")}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(403);
    // DB 照合を通らない URL は fetch すらしない
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("画像応答をそのまま中継し、キャッシュ・nosniff を付与する", async () => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(imageBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    // リダイレクトは自動追従しない（manual で遷移先を再検証する）
    expect(fetchMock).toHaveBeenCalledWith(
      KNOWN_IMAGE_URL,
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(imageBytes));
  });

  it("リダイレクト先も DB にある画像 URL なら追従する", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === KNOWN_IMAGE_URL) {
          return new Response(null, {
            status: 302,
            headers: { location: KNOWN_IMAGE_URL_2 },
          });
        }
        return new Response("img", {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      });

    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      KNOWN_IMAGE_URL_2,
      expect.anything(),
    );
  });

  it("リダイレクト先が DB に無い URL / http なら 502 を返す", async () => {
    for (const location of [
      "https://evil.example.com/x.png",
      "http://s4.anilist.co/a.png",
    ]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 302, headers: { location } }),
      );
      const app = buildProxyApp();
      const res = await app.request(
        `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
        {},
        TEST_BINDINGS,
      );
      expect(res.status).toBe(502);
      vi.restoreAllMocks();
    }
  });

  it("リダイレクトが上限を超えたら 502 を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: KNOWN_IMAGE_URL },
      }),
    );
    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(502);
  });

  it("応答 Content-Type が画像でないとき 502 を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(502);
  });

  it("SVG はスクリプトを含み得るため 502 を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<svg></svg>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(502);
  });

  it("アップストリームが失敗したら 502 を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(502);
  });

  it("アップストリームへの fetch 自体が失敗したら 502 を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(502);
  });

  it("Content-Length が無くても本文が上限を超えたら途中で切って 502 を返す", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            // 6 MB を 1 MB ずつ流す（content-length ヘッダは付けない）
            for (let i = 0; i < 6; i++) controller.enqueue(chunk);
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "image/png" },
        },
      ),
    );
    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(502);
  });

  it("本文の読み取り途中で接続が切れたら 502 を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.error(new Error("connection reset"));
          },
        }),
        {
          status: 200,
          headers: { "content-type": "image/png" },
        },
      ),
    );
    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(502);
  });

  it("Content-Length が上限超過なら 502 を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x", {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(6 * 1024 * 1024),
        },
      }),
    );
    const app = buildProxyApp();
    const res = await app.request(
      `/share/image-proxy?url=${encodeURIComponent(KNOWN_IMAGE_URL)}`,
      {},
      TEST_BINDINGS,
    );
    expect(res.status).toBe(502);
  });
});
