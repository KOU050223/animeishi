import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "@/test-utils/setup-db";
import { annictWorks } from "@/db/schema";
import { currentAnnictSeason, nextAnnictSeason } from "@/lib/annict/client";
import {
  IMAGE_PREFETCH_ATTEMPT_COOLDOWN_MS,
  hostedWorkImageUrl,
  pickWorkImageSource,
  prefetchWorkImages,
  workImageKeyFromUrl,
  workImageKeyPrefix,
} from "@/lib/annict/imagePrefetch";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function makeImageResponse(
  body: Uint8Array = PNG_BYTES,
  contentType: string | null = "image/png",
  init: { status?: number; contentLength?: number } = {},
): Response {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  if (init.contentLength != null) {
    headers.set("content-length", String(init.contentLength));
  }
  return new Response(body, { status: init.status ?? 200, headers });
}

async function insertWork(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  overrides: Partial<typeof annictWorks.$inferInsert> = {},
) {
  const now = new Date();
  const values = {
    annictWorkId: 1,
    title: "作品",
    seasonName: currentAnnictSeason(),
    updatedAt: now,
    ...overrides,
  };
  await db.insert(annictWorks).values(values);
  return values.annictWorkId;
}

describe("pickWorkImageSource", () => {
  it("https の実画像 imageUrl を優先する", () => {
    expect(
      pickWorkImageSource(
        "https://img.example.com/poster.png",
        "https://s4.anilist.co/1.jpg",
      ),
    ).toBe("https://img.example.com/poster.png");
  });

  it("imageUrl が placeholder で resolved があるなら resolved を使う", () => {
    expect(
      pickWorkImageSource(
        "https://pbs.twimg.com/profile_images/1/avatar.jpg",
        "https://s4.anilist.co/1.jpg",
      ),
    ).toBe("https://s4.anilist.co/1.jpg");
    expect(pickWorkImageSource(null, "https://s4.anilist.co/1.jpg")).toBe(
      "https://s4.anilist.co/1.jpg",
    );
  });

  it("http: の imageUrl も取り込み対象（R2 経由で https 配信に化ける）", () => {
    expect(
      pickWorkImageSource("http://youjo-senki.jp/og-image.jpg", null),
    ).toBe("http://youjo-senki.jp/og-image.jpg");
  });

  it("SNS アバターしか無い作品は取り込まない", () => {
    expect(
      pickWorkImageSource(
        "https://pbs.twimg.com/profile_images/1/avatar.jpg",
        null,
      ),
    ).toBeNull();
    expect(pickWorkImageSource(null, null)).toBeNull();
    expect(pickWorkImageSource("", undefined)).toBeNull();
  });

  it("http(s) 以外のスキーム（javascript: / data: 等）は取り込み対象外", () => {
    // isPlaceholderImageUrl はスキームを見ないため、外部データ由来の
    // 非 http(s) URL を取り込み元として返さないことをここで担保する。
    expect(pickWorkImageSource("javascript:alert(1)", null)).toBeNull();
    expect(
      pickWorkImageSource("data:image/png;base64,iVBORw0KGgo=", null),
    ).toBeNull();
    // 画像側が非 http(s) でも、健全な resolvedImageUrl があればそちらを使う
    expect(
      pickWorkImageSource("javascript:alert(1)", "https://s4.anilist.co/1.jpg"),
    ).toBe("https://s4.anilist.co/1.jpg");
  });
});

describe("workImageKey* helpers", () => {
  it("キープレフィックスは works/<id>/<hash> 形式で、ソース URL が変わると変わる", () => {
    const a = workImageKeyPrefix(42, "https://img.example.com/a.png");
    expect(a).toMatch(/^works\/42\/[0-9a-f]{8}$/);
    // 同じ入力は同じキー（冪等取り込みの判定に使う）
    expect(workImageKeyPrefix(42, "https://img.example.com/a.png")).toBe(a);
    // ソース差し替えは別キー → 再取り込みが起きる
    expect(workImageKeyPrefix(42, "https://img.example.com/b.png")).not.toBe(a);
    // 作品ごとに名前空間が分かれる
    expect(workImageKeyPrefix(43, "https://img.example.com/a.png")).not.toBe(a);
  });

  it("hostedWorkImageUrl と workImageKeyFromUrl が往復する", () => {
    const key = `${workImageKeyPrefix(42, "https://img.example.com/a.png")}.png`;
    const url = hostedWorkImageUrl(
      "https://api.example.com/works/search?x=1",
      key,
    );
    expect(url).toBe(`https://api.example.com/images/${key}`);
    expect(workImageKeyFromUrl(url)).toBe(key);
    // ローカル開発（http オリジン）でも組み立てられる
    expect(hostedWorkImageUrl("http://localhost:8787/x", key)).toBe(
      `http://localhost:8787/images/${key}`,
    );
  });

  it("works/ 以外のキーや不正なパスは null", () => {
    // アバター等の他用途オブジェクトには到達させない
    expect(
      workImageKeyFromUrl("https://x.test/images/avatars/u/1.webp"),
    ).toBeNull();
    expect(workImageKeyFromUrl("https://x.test/images/../etc")).toBeNull();
    expect(
      workImageKeyFromUrl("https://x.test/other/works/1/abcdef12.png"),
    ).toBeNull();
    // 数値でない作品 ID / 未知の拡張子
    expect(
      workImageKeyFromUrl("https://x.test/images/works/abc/abcdef12.png"),
    ).toBeNull();
    expect(
      workImageKeyFromUrl("https://x.test/images/works/1/abcdef12.svg"),
    ).toBeNull();
    expect(workImageKeyFromUrl("not a url")).toBeNull();
    expect(workImageKeyFromUrl(null)).toBeNull();
    // 不正な % エスケープ列で decodeURIComponent が投げても 404 扱いにする
    expect(
      workImageKeyFromUrl("https://x.test/images/works/1/%zz.png"),
    ).toBeNull();
    expect(hostedWorkImageUrl("https://x.test/x", null)).toBeNull();
  });
});

describe("prefetchWorkImages", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("今期作品の画像を R2 に取り込み、image_r2_key を保存する", async () => {
    await insertWork(db, {
      annictWorkId: 101,
      imageUrl: "https://img.example.com/p101.png",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => makeImageResponse());

    const result = await prefetchWorkImages(db, env.AVATARS);

    expect(result).toEqual({ scanned: 1, stored: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://img.example.com/p101.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 101),
    });
    expect(row?.imageR2Key).toMatch(/^works\/101\/[0-9a-f]{8}\.png$/);
    expect(row?.imageR2AttemptedAt).not.toBeNull();

    const object = await env.AVATARS.get(row!.imageR2Key!);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe("image/png");
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("resolvedImageUrl（フォールバック解決済み）も取り込み対象にする", async () => {
    await insertWork(db, {
      annictWorkId: 102,
      imageUrl: "https://pbs.twimg.com/profile_images/1/avatar.jpg",
      resolvedImageUrl: "https://s4.anilist.co/102.jpg",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        makeImageResponse(PNG_BYTES, "image/jpeg"),
      );

    const result = await prefetchWorkImages(db, env.AVATARS);

    // SNS アバターの方ではなく resolvedImageUrl を取り込む
    expect(fetchMock).toHaveBeenCalledWith(
      "https://s4.anilist.co/102.jpg",
      expect.anything(),
    );
    expect(result.stored).toBe(1);
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 102),
    });
    expect(row?.imageR2Key).toMatch(/^works\/102\/[0-9a-f]{8}\.jpg$/);
  });

  it("取り込み済み（キー一致）の作品は再 fetch しない", async () => {
    const source = "https://img.example.com/p103.png";
    await insertWork(db, {
      annictWorkId: 103,
      imageUrl: source,
      imageR2Key: `${workImageKeyPrefix(103, source)}.png`,
      imageR2AttemptedAt: new Date(
        Date.now() - IMAGE_PREFETCH_ATTEMPT_COOLDOWN_MS - 1000,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await prefetchWorkImages(db, env.AVATARS);

    expect(result).toEqual({ scanned: 1, stored: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    // 「確認済み」として attempted は再び立つ（次回以降もローテーションする）
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 103),
    });
    expect(row?.imageR2AttemptedAt).not.toBeNull();
  });

  it("対象外シーズン（今期・来期以外）の作品は走査しない", async () => {
    await insertWork(db, {
      annictWorkId: 104,
      seasonName: "1999-winter",
      imageUrl: "https://img.example.com/p104.png",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await prefetchWorkImages(db, env.AVATARS);

    expect(result.scanned).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("来期シーズンの作品も取り込み対象に含む", async () => {
    await insertWork(db, {
      annictWorkId: 105,
      seasonName: nextAnnictSeason(),
      imageUrl: "https://img.example.com/p105.png",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeImageResponse(),
    );

    const result = await prefetchWorkImages(db, env.AVATARS);
    expect(result.stored).toBe(1);
  });

  it("クールダウン内（直近に試行済み）の作品はスキップする", async () => {
    await insertWork(db, {
      annictWorkId: 106,
      imageUrl: "https://img.example.com/p106.png",
      imageR2AttemptedAt: new Date(),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await prefetchWorkImages(db, env.AVATARS);

    expect(result.scanned).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch 失敗（上流 500）は failed として attempted を立て、キーは残さない", async () => {
    await insertWork(db, {
      annictWorkId: 107,
      imageUrl: "https://img.example.com/p107.png",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeImageResponse(PNG_BYTES, "image/png", { status: 500 }),
    );

    const result = await prefetchWorkImages(db, env.AVATARS);

    expect(result).toEqual({ scanned: 1, stored: 0, failed: 1 });
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 107),
    });
    expect(row?.imageR2Key).toBeNull();
    // 失敗でも attempted が立つので、次回実行はクールダウン後になる
    expect(row?.imageR2AttemptedAt).not.toBeNull();
  });

  it("画像でない Content-Type（text/html 等）は取り込まない", async () => {
    const url = "https://img.example.com/p108.png";
    await insertWork(db, {
      annictWorkId: 108,
      imageUrl: url,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeImageResponse(new Uint8Array([0x3c, 0x21]), "text/html"),
    );

    const result = await prefetchWorkImages(db, env.AVATARS);

    expect(result.failed).toBe(1);
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 108),
    });
    expect(row?.imageR2Key).toBeNull();
    // 当該作品のキープレフィックスにオブジェクトが残っていないこと
    // （R2 バケットはテスト間で共有されるため、他テストの works/ とは分けて見る）
    const listed = await env.AVATARS.list({
      prefix: workImageKeyPrefix(108, url),
    });
    expect(listed.objects).toHaveLength(0);
  });

  it("content-length が上限超過と分かっている応答は取り込まない", async () => {
    await insertWork(db, {
      annictWorkId: 109,
      imageUrl: "https://img.example.com/p109.png",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeImageResponse(PNG_BYTES, "image/png", {
        contentLength: 6 * 1024 * 1024,
      }),
    );

    const result = await prefetchWorkImages(db, env.AVATARS);
    expect(result.failed).toBe(1);
  });

  it("取り込み元が差し替わった作品は新しいキーで再取り込みし、旧オブジェクトを消す", async () => {
    const oldKey = `${workImageKeyPrefix(110, "https://img.example.com/old.png")}.png`;
    await env.AVATARS.put(oldKey, PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertWork(db, {
      annictWorkId: 110,
      imageUrl: "https://img.example.com/new.png",
      imageR2Key: oldKey,
      imageR2AttemptedAt: new Date(
        Date.now() - IMAGE_PREFETCH_ATTEMPT_COOLDOWN_MS - 1000,
      ),
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeImageResponse(PNG_BYTES, "image/webp"),
    );

    const result = await prefetchWorkImages(db, env.AVATARS);

    expect(result.stored).toBe(1);
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 110),
    });
    expect(row?.imageR2Key).toMatch(/^works\/110\/[0-9a-f]{8}\.webp$/);
    expect(row?.imageR2Key).not.toBe(oldKey);
    // 旧ソースのオブジェクトは削除される（ゴミを残さない）
    expect(await env.AVATARS.get(oldKey)).toBeNull();
  });

  it("取り込み元の無い作品（SNS placeholder のみ）は fetch せず attempted だけ立てる", async () => {
    await insertWork(db, {
      annictWorkId: 111,
      imageUrl: "https://pbs.twimg.com/profile_images/1/avatar.jpg",
      resolvedImageUrl: null,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await prefetchWorkImages(db, env.AVATARS);

    expect(result).toEqual({ scanned: 1, stored: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await db.query.annictWorks.findFirst({
      where: (t, { eq }) => eq(t.annictWorkId, 111),
    });
    expect(row?.imageR2AttemptedAt).not.toBeNull();
  });
});
