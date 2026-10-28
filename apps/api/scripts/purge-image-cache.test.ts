import { describe, it, expect, vi } from "vitest";
import {
  purgeBodies,
  purgeImageCache,
  resolvePurgeEnv,
  workImageTag,
  workImageUrl,
} from "./purge-image-cache.mjs";

// takedown-work-images.sh から呼ばれるキャッシュ Purge の振る舞いを検証する
// （issue #244）。fetch は注入して Cloudflare API へ実際に送らない。

const BASE = "https://animeishi-api.uomi.dev";
const OPTIONS = { zoneId: "zone-123", token: "token", apiBase: BASE };

function ids(n: number, start = 1): string[] {
  return Array.from({ length: n }, (_, i) => String(start + i));
}

function okResponse() {
  return new Response(JSON.stringify({ success: true, errors: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("workImageUrl / workImageTag", () => {
  it("作品 ID からプロキシ URL と Purge タグを組み立てる", () => {
    expect(workImageUrl(BASE, "42")).toBe(
      "https://animeishi-api.uomi.dev/images/works/42",
    );
    expect(workImageTag("42")).toBe("work-image-42");
  });
});

describe("purgeBodies", () => {
  it("タグと URL の両方の Purge ボディを作る", () => {
    const bodies = purgeBodies(["1", "2"], BASE);
    expect(bodies).toEqual([
      {
        files: [
          "https://animeishi-api.uomi.dev/images/works/1",
          "https://animeishi-api.uomi.dev/images/works/2",
        ],
      },
      { tags: ["work-image-1", "work-image-2"] },
    ]);
  });

  it("1 リクエストの上限（100 件）で分割する", () => {
    const bodies = purgeBodies(ids(250), BASE);
    const files = bodies.filter((b) => "files" in b);
    const tags = bodies.filter((b) => "tags" in b);
    expect(files.map((b) => b.files?.length)).toEqual([100, 100, 50]);
    expect(tags.map((b) => b.tags?.length)).toEqual([100, 100, 50]);
  });
});

describe("purgeImageCache", () => {
  it("Cloudflare API に Bearer トークンと JSON ボディで送る", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const failures = await purgeImageCache(["7"], {
      ...OPTIONS,
      fetchImpl,
    });

    expect(failures).toEqual([]);
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe(
      "https://api.cloudflare.com/client/v4/zones/zone-123/purge_cache",
    );
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      files: ["https://animeishi-api.uomi.dev/images/works/7"],
    });
  });

  it("全件成功なら失敗なし", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    // 250 件 → files/tags それぞれ 3 リクエスト
    const failures = await purgeImageCache(ids(250), {
      ...OPTIONS,
      fetchImpl,
    });
    expect(failures).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("429 / 5xx はリトライする", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, { status: 429 });
      }
      return okResponse();
    });
    const sleep = vi.fn(async () => {});
    const failures = await purgeImageCache(["1"], {
      ...OPTIONS,
      fetchImpl,
      sleep,
    });
    expect(failures).toEqual([]);
    expect(calls).toBe(3); // files 失敗→成功、tags 成功
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("4xx はリトライせず失敗として返す", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "Invalid zone identifier" }],
          }),
          { status: 400 },
        ),
    );
    const failures = await purgeImageCache(["9"], {
      ...OPTIONS,
      fetchImpl,
      sleep: vi.fn(async () => {}),
    });
    expect(failures).toHaveLength(2); // files と tags の両方
    expect(failures[0]?.detail).toContain("Invalid zone identifier");
    // files は 1 回だけ呼ばれる（リトライしない）
    const bodies = fetchImpl.mock.calls.map((c) => String(c[1]?.body));
    expect(bodies.filter((b) => b.includes('"files"')).length).toBe(1);
  });

  it("通信エラーはリトライのうえ失敗として返す", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket hangup");
    });
    const sleep = vi.fn(async () => {});
    const failures = await purgeImageCache(["3"], {
      ...OPTIONS,
      fetchImpl,
      sleep,
    });
    expect(failures).toHaveLength(2);
    expect(failures[0]?.detail).toContain("socket hangup");
    // files 分は 3 回試行
    const fileCalls = fetchImpl.mock.calls.filter((c) =>
      String(c[1]?.body).includes('"files"'),
    );
    expect(fileCalls).toHaveLength(3);
  });
});

describe("resolvePurgeEnv", () => {
  it("必要な環境変数が揃っていれば ok", () => {
    const result = resolvePurgeEnv({
      CLOUDFLARE_ZONE_ID: "z",
      CLOUDFLARE_PURGE_API_TOKEN: "t",
    });
    expect(result).toEqual({
      ok: true,
      zoneId: "z",
      token: "t",
      apiBase: "https://animeishi-api.uomi.dev",
    });
  });

  it("IMAGE_PROXY_BASE_URL でオリジンを上書きできる（末尾 / は落とす）", () => {
    const result = resolvePurgeEnv({
      CLOUDFLARE_ZONE_ID: "z",
      CLOUDFLARE_PURGE_API_TOKEN: "t",
      IMAGE_PROXY_BASE_URL: "https://api.example.com/",
    });
    expect(result.ok && result.apiBase).toBe("https://api.example.com");
  });

  it("不足している変数名を返す", () => {
    const result = resolvePurgeEnv({});
    expect(result).toEqual({
      ok: false,
      missing: ["CLOUDFLARE_ZONE_ID", "CLOUDFLARE_PURGE_API_TOKEN"],
    });
  });
});
