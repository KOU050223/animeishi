import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test-utils/setup-db";
import { requestUrl } from "@/test-utils/fetch";
import {
  isKitsuAnimeListUrl,
  isKitsuMappingsUrl,
  makeKitsuAnimeListResponse,
  makeKitsuResponse,
} from "@/test-utils/kitsu";
import { IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS } from "@/lib/annict/imageFallback";
import { annictWorks } from "@/db/schema";
import {
  WORK_IMAGE_FAILURE_COOLDOWN_MS,
  serveWorkImage,
  workImageKey,
  workImageSourceCandidates,
  workImageUrl,
} from "@/lib/annict/workImage";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function makeImageResponse(
  contentType: string | null = "image/png",
  init: { status?: number; contentLength?: number } = {},
): Response {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  if (init.contentLength != null) {
    headers.set("content-length", String(init.contentLength));
  }
  return new Response(PNG_BYTES, { status: init.status ?? 200, headers });
}

type Db = Awaited<ReturnType<typeof setupTestDb>>;

async function insertWork(
  db: Db,
  overrides: Partial<typeof annictWorks.$inferInsert> = {},
) {
  const values = {
    annictWorkId: 1,
    title: "作品",
    updatedAt: new Date(),
    ...overrides,
  };
  await db.insert(annictWorks).values(values);
  return values.annictWorkId;
}

async function getWork(db: Db, annictWorkId = 1) {
  const [row] = await db
    .select()
    .from(annictWorks)
    .where(eq(annictWorks.annictWorkId, annictWorkId));
  return row;
}

// URL ごとの応答を決め打ちする fetch。未定義の URL は 404。
// Kitsu の API はクエリ文字列付きで呼ばれるので、KITSU（mappings）/
// KITSU_ANIME（作品一覧）キーで受ける。
const KITSU = "kitsu";
const KITSU_ANIME = "kitsuAnime";
function routeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    const route = isKitsuMappingsUrl(url)
      ? routes[KITSU]
      : isKitsuAnimeListUrl(url)
        ? routes[KITSU_ANIME]
        : routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  });
}

describe("workImageSourceCandidates", () => {
  it("https の実画像と補完 URL をどちらも候補に含める", () => {
    const candidates = workImageSourceCandidates({
      imageUrl: "https://img.example.com/poster.png",
      resolvedImageUrl: "https://s4.anilist.co/1.jpg",
    });
    expect(candidates).toEqual(
      expect.arrayContaining([
        "https://img.example.com/poster.png",
        "https://s4.anilist.co/1.jpg",
      ]),
    );
  });

  it("SNS アバターは作品画像ではないので候補にしない", () => {
    expect(
      workImageSourceCandidates({
        imageUrl: "https://pbs.twimg.com/profile_images/1/avatar.jpg",
        resolvedImageUrl: null,
      }),
    ).toEqual([]);
  });

  it("内部宛先・非 https スキームは候補にしない（SSRF 対策）", () => {
    for (const imageUrl of [
      "https://10.0.0.1/x.png",
      "https://169.254.169.254/latest/meta-data.png",
      "https://localhost/x.png",
      "https://img.example.com:8443/x.png",
      "javascript:alert(1)",
      "data:image/png;base64,iVBORw0KGgo=",
    ]) {
      expect(
        workImageSourceCandidates({ imageUrl, resolvedImageUrl: null }),
      ).toEqual([]);
    }
  });

  it("どの候補も https の公開ホストで、重複を含まない", () => {
    const candidates = workImageSourceCandidates({
      imageUrl: "http://youjo-senki.jp/og-image.jpg",
      resolvedImageUrl: "https://s4.anilist.co/1.jpg",
    });
    for (const url of candidates) expect(url).toMatch(/^https:\/\//);
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates).toContain("https://s4.anilist.co/1.jpg");
  });

  it("何も無ければ空配列", () => {
    expect(
      workImageSourceCandidates({ imageUrl: null, resolvedImageUrl: null }),
    ).toEqual([]);
    expect(
      workImageSourceCandidates({ imageUrl: "", resolvedImageUrl: undefined }),
    ).toEqual([]);
  });

  it("&amp; でエスケープされた URL は & に戻してから候補にする", () => {
    // 本番 DB に `&` が `&amp;` で入っている行があったための防御。
    // そのまま fetch すると署名パラメータ名が壊れて必ず失敗する。
    expect(
      workImageSourceCandidates({
        imageUrl: null,
        resolvedImageUrl: "https://img.example.com/p.png?a=1&amp;b=2",
      }),
    ).toEqual(["https://img.example.com/p.png?a=1&b=2"]);
  });
});

describe("workImageUrl", () => {
  it("リクエスト先オリジンに /images/works/<id> を載せる", () => {
    expect(workImageUrl("https://api.example.com/works/search?q=a", 42)).toBe(
      "https://api.example.com/images/works/42",
    );
  });

  it("ID が無ければ null", () => {
    expect(workImageUrl("https://api.example.com/", null)).toBeNull();
    expect(workImageUrl("https://api.example.com/", undefined)).toBeNull();
  });
});

describe("serveWorkImage", () => {
  let db: Db;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    const listed = await env.AVATARS.list();
    if (listed.objects.length > 0) {
      await env.AVATARS.delete(listed.objects.map((o) => o.key));
    }
  });

  it("annict_works に無い作品は外部を叩かず 404", async () => {
    const fetchImpl = vi.fn();
    const res = await serveWorkImage(db, env.AVATARS, 999, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("取り込み済みなら R2 から返し、外部を叩かない", async () => {
    const key = "works/1/deadbeef.png";
    await env.AVATARS.put(key, PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertWork(db, { imageR2Key: key });
    const fetchImpl = vi.fn();

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toMatch(/max-age=86400/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("未取り込みなら外部から取得して R2 に保存し、キーを記録する", async () => {
    const source = "https://s4.anilist.co/1.jpg";
    await insertWork(db, { resolvedImageUrl: source });
    const fetchImpl = routeFetch({ [source]: () => makeImageResponse() });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    const expectedKey = workImageKey(1, source, "png");
    expect((await getWork(db)).imageR2Key).toBe(expectedKey);
    const stored = await env.AVATARS.get(expectedKey);
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
  });

  it("Annict の URL が実際には 404 でも、補完 URL で取り込める", async () => {
    // 本番で欠損が多かった原因: URL の見た目はまともで placeholder 判定に
    // 掛からないが、実体は消えている公式サイト画像。
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      resolvedImageUrl: "https://s4.anilist.co/1.jpg",
    });
    const fetchImpl = routeFetch({
      "https://s4.anilist.co/1.jpg": () => makeImageResponse("image/jpeg"),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect((await getWork(db)).imageR2Key).toBe(
      workImageKey(1, "https://s4.anilist.co/1.jpg", "jpg"),
    );
  });

  it("候補が全滅で未解決なら Kitsu を引き直し、その画像を取り込む", async () => {
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      malAnimeId: 5114,
    });
    const cover = "https://s4.anilist.co/5114.jpg";
    const fetchImpl = routeFetch({
      [KITSU]: () =>
        makeKitsuResponse({ m5114: { coverImage: { extraLarge: cover } } }),
      [cover]: () => makeImageResponse("image/jpeg"),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    const row = await getWork(db);
    expect(row.resolvedImageUrl).toBe(cover);
    expect(row.imageSource).toBe("kitsu");
    expect(row.imageR2Key).toBe(workImageKey(1, cover, "jpg"));
  });

  it("resolvedImageUrl が失効した署名付き URL でも、Kitsu を引き直して取り込む", async () => {
    // Kitsu の新しい作品は 15 分で失効する署名付き URL
    // （kitsu-production-media.s3...backblazeb2.com?X-Amz-...）が返る。
    // 失効後は candidates 側の fetch が 403 になるため、MAL ID で Kitsu の
    // mappings を引き直して新しい署名付き URL を取り、その場で R2 に保存する。
    const expired =
      "https://kitsu-production-media.s3.us-west-002.backblazeb2.com/anime/50212/poster_image/2816144fa83a3ed0cfd57210096749ad.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261001T000000Z&X-Amz-Expires=900&X-Amz-Signature=old";
    const reissued =
      "https://kitsu-production-media.s3.us-west-002.backblazeb2.com/anime/50212/poster_image/2816144fa83a3ed0cfd57210096749ad.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261022T000000Z&X-Amz-Expires=900&X-Amz-Signature=new";
    await insertWork(db, {
      malAnimeId: 61806,
      resolvedImageUrl: expired,
      imageSource: "kitsu",
    });
    const fetchImpl = routeFetch({
      [expired]: () => new Response("expired", { status: 403 }),
      [KITSU]: () =>
        makeKitsuResponse({
          m61806: { coverImage: { extraLarge: reissued } },
        }),
      [reissued]: () => makeImageResponse("image/jpeg"),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("kitsu.io"),
      expect.anything(),
    );
    const row = await getWork(db);
    expect(row.resolvedImageUrl).toBe(reissued);
    expect(row.imageR2Key).toBe(workImageKey(1, reissued, "jpg"));
    expect(
      await env.AVATARS.get(workImageKey(1, reissued, "jpg")),
    ).not.toBeNull();
  });

  it("Kitsu に対応が無い作品は 404 のまま。ただし Kitsu までは引く", async () => {
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      malAnimeId: 50099,
    });
    const fetchImpl = routeFetch({
      [KITSU]: () => makeKitsuResponse({ m50099: null }),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("kitsu.io"),
      expect.anything(),
    );
    // Kitsu miss が確定したのでネガキャッシュが書き込まれる
    // （Kitsu リクエスト自体の失敗とは区別する）。
    expect((await getWork(db)).imageSource).toBe("none");
  });

  it("Kitsu に対応が無くても、MAL Client ID があれば MAL API の画像を取り込む", async () => {
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      malAnimeId: 50099,
    });
    const picture = "https://cdn.myanimelist.net/images/anime/50099l.jpg";
    const fetchImpl = routeFetch({
      [KITSU]: () => makeKitsuResponse({ m50099: null }),
      "https://api.myanimelist.net/v2/anime/50099?fields=main_picture": () =>
        Response.json({ main_picture: { large: picture } }),
      [picture]: () => makeImageResponse("image/jpeg"),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      malClientId: "client-id",
    });

    expect(res.status).toBe(200);
    const row = await getWork(db);
    expect(row.resolvedImageUrl).toBe(picture);
    expect(row.imageSource).toBe("mal");
    expect(row.imageR2Key).toBe(workImageKey(1, picture, "jpg"));
  });

  it("MAL ID が無く Kitsu 作品 ID のみの作品も、全滅時に Kitsu を引き直して取り込む", async () => {
    // タイトル検索（issue #227）で MAL mapping が無かった行は
    // kitsu_anime_id だけを持つ。/anime?filter[id]= でポスターを引き直す。
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      kitsuAnimeId: 50743,
    });
    const cover = "https://media.kitsu.app/50743.jpg";
    const fetchImpl = routeFetch({
      [KITSU_ANIME]: () => makeKitsuAnimeListResponse({ "50743": cover }),
      [cover]: () => makeImageResponse("image/jpeg"),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    const row = await getWork(db);
    expect(row.resolvedImageUrl).toBe(cover);
    expect(row.imageSource).toBe("kitsu");
    expect(row.imageR2Key).toBe(workImageKey(1, cover, "jpg"));
  });

  it("Kitsu 作品 ID でもポスターが無ければ 'none' が確定して 404", async () => {
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      kitsuAnimeId: 50743,
    });
    const fetchImpl = routeFetch({
      [KITSU_ANIME]: () => makeKitsuAnimeListResponse({ "50743": null }),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(404);
    expect((await getWork(db)).imageSource).toBe("none");
  });

  it("MAL 由来の画像は Cache-Control を短くする（合計 12 時間以下。issue #241）", async () => {
    const totalSeconds = (cacheControl: string | null) => {
      const maxAge = Number(/max-age=(\d+)/.exec(cacheControl ?? "")?.[1]);
      const swr = Number(
        /stale-while-revalidate=(\d+)/.exec(cacheControl ?? "")?.[1] ?? 0,
      );
      return maxAge + swr;
    };
    // 取り込み済み（R2 から返す）
    const key = "works/1/deadbeef.png";
    await env.AVATARS.put(key, PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertWork(db, { imageR2Key: key, imageSource: "mal" });
    const stored = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: routeFetch({}) as unknown as typeof fetch,
    });
    expect(stored.status).toBe(200);
    expect(
      totalSeconds(stored.headers.get("cache-control")),
    ).toBeLessThanOrEqual(12 * 60 * 60);

    // その場で MAL API から引いて取り込む
    await insertWork(db, {
      annictWorkId: 2,
      imageUrl: "https://old-official.example.com/og.png",
      malAnimeId: 50099,
    });
    const picture = "https://cdn.myanimelist.net/images/anime/50099l.jpg";
    const fetched = await serveWorkImage(db, env.AVATARS, 2, {
      fetchImpl: routeFetch({
        [KITSU]: () => makeKitsuResponse({ m50099: null }),
        "https://api.myanimelist.net/v2/anime/50099?fields=main_picture": () =>
          Response.json({ main_picture: { large: picture } }),
        [picture]: () => makeImageResponse("image/jpeg"),
      }) as unknown as typeof fetch,
      malClientId: "client-id",
    });
    expect(fetched.status).toBe(200);
    expect(
      totalSeconds(fetched.headers.get("cache-control")),
    ).toBeLessThanOrEqual(12 * 60 * 60);

    // Kitsu 由来は従来どおり 1 日
    await insertWork(db, {
      annictWorkId: 3,
      resolvedImageUrl: "https://media.kitsu.app/3.jpg",
      imageSource: "kitsu",
    });
    const kitsu = await serveWorkImage(db, env.AVATARS, 3, {
      fetchImpl: routeFetch({
        "https://media.kitsu.app/3.jpg": () => makeImageResponse("image/jpeg"),
      }) as unknown as typeof fetch,
    });
    expect(kitsu.headers.get("cache-control")).toBe(
      "public, max-age=86400, stale-while-revalidate=604800",
    );
  });

  describe("削除依頼で画像を消した作品（image_source='blocked'。issue #241）", () => {
    it("補完 URL は使わず、Annict の元の画像だけを取り込む", async () => {
      const annict = "https://img.example.com/poster.png";
      const mal = "https://cdn.myanimelist.net/images/anime/21l.jpg";
      // 削除後に補完 URL が書き戻っていても拾わないことを確かめる。
      await insertWork(db, {
        imageUrl: annict,
        resolvedImageUrl: mal,
        imageSource: "blocked",
        malAnimeId: 21,
      });
      const fetchImpl = routeFetch({
        [annict]: () => makeImageResponse(),
        [mal]: () => makeImageResponse("image/jpeg"),
      });

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        malClientId: "client-id",
      });

      expect(res.status).toBe(200);
      expect(fetchImpl).not.toHaveBeenCalledWith(mal, expect.anything());
      expect((await getWork(db)).imageR2Key).toBe(
        workImageKey(1, annict, "png"),
      );
    });

    it("削除スクリプトが R2 を消す前の MAL 画像は配信せず、キーも残す", async () => {
      // 削除スクリプトは行を 'blocked' にしてから R2 を消し、消せたキーを外す。
      // その間に残っている MAL 画像は配信しない。キーの掃除はスクリプトに任せる。
      const mal = "https://cdn.myanimelist.net/images/anime/21l.jpg";
      const key = workImageKey(1, mal, "jpg");
      await env.AVATARS.put(key, PNG_BYTES, {
        httpMetadata: { contentType: "image/jpeg" },
      });
      await insertWork(db, {
        imageUrl: "https://old-official.example.com/og.png",
        imageSource: "blocked",
        imageR2Key: key,
        malAnimeId: 21,
      });

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: routeFetch({}) as unknown as typeof fetch,
      });

      expect(res.status).toBe(404);
      expect((await getWork(db)).imageR2Key).toBe(key);
      expect(await env.AVATARS.get(key)).not.toBeNull();
    });

    it("取り込み中に行が 'blocked' になったら、キーを書き戻さず置いた画像も消す", async () => {
      const picture = "https://cdn.myanimelist.net/images/anime/50099l.jpg";
      await insertWork(db, {
        imageUrl: "https://old-official.example.com/og.png",
        malAnimeId: 50099,
      });
      const fetchImpl = routeFetch({
        [KITSU]: () => makeKitsuResponse({ m50099: null }),
        "https://api.myanimelist.net/v2/anime/50099?fields=main_picture": () =>
          Response.json({ main_picture: { large: picture } }),
        [picture]: () => makeImageResponse("image/jpeg"),
      });
      // MAL の画像を取りに行った時点で削除スクリプトが走ったことにする。
      const blockingFetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          if (requestUrl(input) === picture) {
            await db
              .update(annictWorks)
              .set({ imageSource: "blocked", resolvedImageUrl: null })
              .where(eq(annictWorks.annictWorkId, 1));
          }
          return fetchImpl(input, init);
        },
      );

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: blockingFetch as unknown as typeof fetch,
        malClientId: "client-id",
      });

      expect(res.status).toBe(404);
      expect((await getWork(db)).imageR2Key).toBeNull();
      expect(await env.AVATARS.get(workImageKey(1, picture, "jpg"))).toBeNull();
    });

    it("Annict の画像が取れなくても Kitsu・MAL を引き直さず 404", async () => {
      await insertWork(db, {
        imageUrl: "https://old-official.example.com/og.png",
        imageSource: "blocked",
        malAnimeId: 21,
      });
      const fetchImpl = routeFetch({
        [KITSU]: () =>
          makeKitsuResponse({
            m21: {
              coverImage: { extraLarge: "https://media.kitsu.app/21.jpg" },
            },
          }),
      });

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        malClientId: "client-id",
      });

      expect(res.status).toBe(404);
      const calledUrls = fetchImpl.mock.calls.map(([input]) =>
        requestUrl(input),
      );
      expect(calledUrls).toEqual(["https://old-official.example.com/og.png"]);
      const row = await getWork(db);
      expect(row.imageSource).toBe("blocked");
      expect(row.resolvedImageUrl).toBeNull();
    });
  });

  it("imageSource='none' が TTL 内なら Kitsu を引き直さない", async () => {
    // 'none' は「Kitsu にも画像が無い」ことが確定済みのネガキャッシュ。
    // 確定から TTL（IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS）以内は
    // 表示されても Kitsu を叩かない。
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      malAnimeId: 50099,
      imageSource: "none",
      resolvedAt: new Date(),
    });
    const fetchImpl = routeFetch({});

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("kitsu.io"),
      expect.anything(),
    );
  });

  it("imageSource='none' が TTL 切れなら Kitsu を引き直して取り込む", async () => {
    // 'none' 確定後に Annict の URL が「見た目は正常だが実体は 404」に
    // 更新されると cron の pending 対象外（非 placeholder URL は対象外）
    // になるため、プロキシ側でも TTL 切れの 'none' は再解決する。
    // 将来 Kitsu に画像が登録された作品をここで救う。
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      malAnimeId: 5114,
      imageSource: "none",
      resolvedAt: new Date(
        Date.now() - IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS - 1000,
      ),
    });
    const cover = "https://s4.anilist.co/5114.jpg";
    const fetchImpl = routeFetch({
      [KITSU]: () =>
        makeKitsuResponse({ m5114: { coverImage: { extraLarge: cover } } }),
      [cover]: () => makeImageResponse("image/jpeg"),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    const row = await getWork(db);
    expect(row.imageSource).toBe("kitsu");
    expect(row.resolvedImageUrl).toBe(cover);
    expect(row.imageR2Key).toBe(workImageKey(1, cover, "jpg"));
  });

  it("TTL 切れ 'none' の再解決が依然 miss なら resolvedAt を更新して先送りする", async () => {
    // resolvedAt は秒精度で保存されるため、再解決前の古い値より
    // 新しくなったことだけを確認する。
    const stale = new Date(
      Date.now() - IMAGE_FALLBACK_NONE_RESOLVE_AFTER_MS - 60_000,
    );
    await insertWork(db, {
      imageUrl: "https://old-official.example.com/og.png",
      malAnimeId: 50099,
      imageSource: "none",
      resolvedAt: stale,
    });
    const fetchImpl = routeFetch({
      [KITSU]: () => makeKitsuResponse({ m50099: null }),
    });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(404);
    const row = await getWork(db);
    expect(row.imageSource).toBe("none");
    expect(row.resolvedAt?.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("全滅したら 404 を返して試行時刻を立て、クールダウン中は外部を叩かない", async () => {
    await insertWork(db, { resolvedImageUrl: "https://s4.anilist.co/1.jpg" });
    const now = new Date("2026-10-17T00:00:00Z");
    const fetchImpl = routeFetch({});

    const first = await serveWorkImage(db, env.AVATARS, 1, {
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(first.status).toBe(404);
    expect(first.headers.get("cache-control")).toMatch(/max-age=300/);
    expect((await getWork(db)).imageR2AttemptedAt?.getTime()).toBe(
      now.getTime(),
    );

    fetchImpl.mockClear();
    const second = await serveWorkImage(db, env.AVATARS, 1, {
      now: new Date(now.getTime() + 60_000),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(second.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();

    // クールダウン明けは再挑戦する
    await serveWorkImage(db, env.AVATARS, 1, {
      now: new Date(now.getTime() + WORK_IMAGE_FAILURE_COOLDOWN_MS + 1),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("画像でない Content-Type・サイズ超過は取り込まない", async () => {
    await insertWork(db, { resolvedImageUrl: "https://s4.anilist.co/1.jpg" });
    for (const response of [
      () => makeImageResponse("text/html"),
      () => makeImageResponse("image/svg+xml"),
      () => makeImageResponse("image/png", { contentLength: 10 * 1024 * 1024 }),
    ]) {
      await db
        .update(annictWorks)
        .set({ imageR2AttemptedAt: null })
        .where(eq(annictWorks.annictWorkId, 1));
      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: routeFetch({
          "https://s4.anilist.co/1.jpg": response,
        }) as unknown as typeof fetch,
      });
      expect(res.status).toBe(404);
      expect((await getWork(db)).imageR2Key).toBeNull();
    }
  });

  it("リダイレクト先が内部宛先なら追わない（SSRF 対策）", async () => {
    await insertWork(db, { resolvedImageUrl: "https://s4.anilist.co/1.jpg" });
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/meta.png" },
        }),
    );

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("キーはあるが R2 のオブジェクトが消えていれば取り込み直す", async () => {
    // クールダウン中でも取り込み直す（失敗すれば末尾でキーを外して
    // 試行時刻を立てるので、オブジェクト欠損のまま 404 が続かない）。
    const source = "https://s4.anilist.co/1.jpg";
    await insertWork(db, {
      resolvedImageUrl: source,
      imageR2Key: "works/1/0badf00d.png",
      imageR2AttemptedAt: new Date(),
    });
    const fetchImpl = routeFetch({ [source]: () => makeImageResponse() });

    const res = await serveWorkImage(db, env.AVATARS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect((await getWork(db)).imageR2Key).toBe(workImageKey(1, source, "png"));
  });

  describe("取り込み済み画像の鮮度・所有者チェック", () => {
    const OLD_SOURCE = "https://old-official.example.com/og.png";
    const NEW_SOURCE = "https://s4.anilist.co/1.jpg";
    const oldKey = () => workImageKey(1, OLD_SOURCE, "png");
    const longAgo = new Date("2026-01-01T00:00:00Z");

    async function seedStored(
      overrides: Partial<typeof annictWorks.$inferInsert>,
    ) {
      await env.AVATARS.put(oldKey(), PNG_BYTES, {
        httpMetadata: { contentType: "image/png" },
      });
      await insertWork(db, {
        imageR2Key: oldKey(),
        imageR2AttemptedAt: longAgo,
        ...overrides,
      });
    }

    it("取り込み元が今の候補に含まれていれば外部を叩かない", async () => {
      await seedStored({ imageUrl: OLD_SOURCE });
      const fetchImpl = vi.fn();

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(res.status).toBe(200);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("取り込み元が差し替わったら取り込み直し、旧オブジェクトを消す", async () => {
      await seedStored({ imageUrl: null, resolvedImageUrl: NEW_SOURCE });
      const fetchImpl = routeFetch({
        [NEW_SOURCE]: () => makeImageResponse("image/jpeg"),
      });

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(res.status).toBe(200);
      const newKey = workImageKey(1, NEW_SOURCE, "jpg");
      expect((await getWork(db)).imageR2Key).toBe(newKey);
      expect(await env.AVATARS.head(oldKey())).toBeNull();
    });

    it("差し替わっていてもクールダウン中は取り込み済みの画像を返す", async () => {
      const now = new Date("2026-10-17T00:00:00Z");
      await seedStored({
        resolvedImageUrl: NEW_SOURCE,
        imageR2AttemptedAt: new Date(now.getTime() - 60_000),
      });
      const fetchImpl = vi.fn();

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        now,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(res.status).toBe(200);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("取り込み直しに失敗したら古い画像を返し続け、試行時刻を立てる", async () => {
      await seedStored({ resolvedImageUrl: NEW_SOURCE });
      const now = new Date("2026-10-17T00:00:00Z");

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        now,
        fetchImpl: routeFetch({}) as unknown as typeof fetch,
      });

      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
      const row = await getWork(db);
      expect(row.imageR2Key).toBe(oldKey());
      expect(row.imageR2AttemptedAt?.getTime()).toBe(now.getTime());
    });

    it("別作品のキーを指していても配信せず、そのオブジェクトも消さない", async () => {
      const foreignKey = workImageKey(2, OLD_SOURCE, "png");
      await env.AVATARS.put(foreignKey, PNG_BYTES, {
        httpMetadata: { contentType: "image/png" },
      });
      await insertWork(db, { imageR2Key: foreignKey });

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: routeFetch({}) as unknown as typeof fetch,
      });

      expect(res.status).toBe(404);
      expect(await env.AVATARS.head(foreignKey)).not.toBeNull();
      expect((await getWork(db)).imageR2Key).toBeNull();
    });
  });

  describe("署名付き URL（Kitsu / Backblaze B2）の取り扱い", () => {
    // 署名クエリ（X-Amz-*）は再発行のたびに変わるため、キーのハッシュは
    // クエリを除いた部分から取る。そうしないと取り込み済みでも毎回
    // 「取り込み元が変わった」と誤判定されて取り直しが走る。
    const signedAt = (signature: string) =>
      `https://kitsu-production-media.s3.us-west-002.backblazeb2.com/anime/50212/poster_image/2816144fa83a3ed0cfd57210096749ad.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261022T000000Z&X-Amz-Expires=900&X-Amz-Signature=${signature}`;

    it("取り込み時と署名が変わっていても fresh と判定し、外部を叩かない", async () => {
      const key = workImageKey(1, signedAt("oldsignature"), "jpg");
      await env.AVATARS.put(key, PNG_BYTES, {
        httpMetadata: { contentType: "image/jpeg" },
      });
      await insertWork(db, {
        resolvedImageUrl: signedAt("newsignature"),
        imageSource: "kitsu",
        imageR2Key: key,
      });
      const fetchImpl = vi.fn();

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(res.status).toBe(200);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("署名クエリが違ってもオブジェクトの実体が違えば（= パスが違えば）取り直す", async () => {
      const oldUrl = signedAt("oldsignature");
      const newUrl = oldUrl.replace(
        "/2816144fa83a3ed0cfd57210096749ad.jpg",
        "/ffffffffffffffffffffffffffffffff.jpg",
      );
      const oldKey = workImageKey(1, oldUrl, "jpg");
      await env.AVATARS.put(oldKey, PNG_BYTES, {
        httpMetadata: { contentType: "image/jpeg" },
      });
      await insertWork(db, {
        resolvedImageUrl: newUrl,
        imageSource: "kitsu",
        imageR2Key: oldKey,
        imageR2AttemptedAt: new Date("2026-01-01T00:00:00Z"),
      });
      const fetchImpl = routeFetch({
        [newUrl]: () => makeImageResponse("image/jpeg"),
      });

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(res.status).toBe(200);
      expect((await getWork(db)).imageR2Key).toBe(
        workImageKey(1, newUrl, "jpg"),
      );
      expect(await env.AVATARS.head(oldKey)).toBeNull();
    });

    it("DB に &amp; で入っている署名付き URL は & に戻してから取りに行く", async () => {
      const escaped = signedAt("sig").replace(/&/g, "&amp;");
      const unescaped = signedAt("sig");
      await insertWork(db, { resolvedImageUrl: escaped });
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        // &amp; のまま叩かれたら失敗とみなす
        return url === unescaped
          ? makeImageResponse("image/jpeg")
          : new Response("bad query", { status: 403 });
      });

      const res = await serveWorkImage(db, env.AVATARS, 1, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(res.status).toBe(200);
      expect(fetchImpl).toHaveBeenCalledWith(unescaped, expect.anything());
    });
  });
});
