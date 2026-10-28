import { describe, it, expect, vi } from "vitest";
import {
  isKitsuCharactersUrl,
  isKitsuMappingsUrl,
  makeKitsuCharactersResponse,
  makeKitsuResponse,
} from "@/test-utils/kitsu";
import { requestUrl } from "@/test-utils/fetch";
import {
  fetchKitsuCharacters,
  matchCharacterImages,
  normalizeCharacterName,
  type KitsuCharacter,
} from "./characterImageFallback";

describe("normalizeCharacterName", () => {
  it("空白・中黒・括弧・区切り記号を除去する", () => {
    expect(normalizeCharacterName("山田 太郎")).toBe("山田太郎");
    expect(normalizeCharacterName("山田・太郎")).toBe("山田太郎");
    expect(normalizeCharacterName("山田（たろう）")).toBe("山田タロウ");
    expect(normalizeCharacterName("山田・T・太郎")).toBe("山田t太郎");
  });

  it("ひらがなをカタカナに揃える", () => {
    expect(normalizeCharacterName("きらら")).toBe("キララ");
    expect(normalizeCharacterName("ほしの るびー")).toBe("ホシノルビー");
  });

  it("NFKC で全角英数を半角に揃え、小文字化する", () => {
    expect(normalizeCharacterName("ＡＢＣ１２３")).toBe("abc123");
  });

  it("空白だけの名前は空文字になる", () => {
    expect(normalizeCharacterName("  ")).toBe("");
  });
});

const kitsu = (
  names: string[],
  imageUrl: string | null = "https://img.example/c.png",
): KitsuCharacter => ({ names, imageUrl });

const annict = (
  annictCharacterId: number,
  name: string,
  nameKana: string | null = null,
  nameEn: string | null = null,
) => ({ annictCharacterId, name, nameKana, nameEn });

describe("matchCharacterImages", () => {
  it("正規化名が一致するキャラクターに画像を名寄せする", () => {
    const result = matchCharacterImages(
      [annict(1, "山田 太郎"), annict(2, "鈴木花子")],
      [kitsu(["山田太郎"]), kitsu(["別人"])],
    );
    expect(result.get(1)).toBe("https://img.example/c.png");
    expect(result.has(2)).toBe(false);
  });

  it("nameKana / nameEn も照合に使う", () => {
    const result = matchCharacterImages(
      [annict(1, "不明", "ヤマダタロウ"), annict(2, "不明2", null, "Hanako")],
      [kitsu(["やまだ たろう"]), kitsu(["hanako"])],
    );
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
  });

  it("Annict 側が nameKana/nameEn null を返しても落ちない", () => {
    const result = matchCharacterImages(
      [annict(1, "キャラA", null, null)],
      [kitsu(["キャラA"])],
    );
    expect(result.has(1)).toBe(true);
  });

  it("「本名（通称）」表記は括弧を外した名前でも一致する", () => {
    const result = matchCharacterImages(
      [annict(1, "桜内梨子（りこちゃん）")],
      [kitsu(["桜内梨子"])],
    );
    expect(result.has(1)).toBe(true);
  });

  it("Kitsu 側で同名キャラが複数いるキーは ambiguous として除外する", () => {
    const a = kitsu(["双子A"], "https://img.example/a.png");
    const b = kitsu(["双子A"], "https://img.example/b.png");
    const result = matchCharacterImages([annict(1, "双子A")], [a, b]);
    expect(result.has(1)).toBe(false);
  });

  it("1 人の Kitsu キャラが複数の Annict キャラに割り当たった場合は両方とも採用しない", () => {
    // どちらかが誤マッチなので、誤って別キャラの顔を出すより両方外す。
    const shared = kitsu(["キャラA", "キャラA（本名）"]);
    const result = matchCharacterImages(
      [annict(1, "キャラA"), annict(2, "キャラA（本名）")],
      [shared],
    );
    expect(result.has(1)).toBe(false);
    expect(result.has(2)).toBe(false);
  });

  it("imageUrl が無い Kitsu キャラにマッチしても結果に含めない", () => {
    const result = matchCharacterImages(
      [annict(1, "キャラA")],
      [kitsu(["キャラA"], null)],
    );
    expect(result.has(1)).toBe(false);
  });
});

describe("fetchKitsuCharacters", () => {
  // mappings で MAL ID → Kitsu 作品 ID（k<malId>）を解決し、
  // /anime/<id>/characters には渡したキャラクター一覧を返すモック。
  const mockFetch = (
    characters: Parameters<typeof makeKitsuCharactersResponse>[0],
    options: { mappingsFound?: boolean } = {},
  ) =>
    vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (isKitsuMappingsUrl(url)) {
        return options.mappingsFound === false
          ? makeKitsuResponse({})
          : makeKitsuResponse({ m1234: {} });
      }
      if (isKitsuCharactersUrl(url)) {
        return makeKitsuCharactersResponse(characters);
      }
      return new Response("unexpected", { status: 500 });
    });

  it("キャラクター名の候補と画像を返す（mappings → characters の順で問い合わせる）", async () => {
    const fetchMock = mockFetch([
      {
        id: "c1",
        canonicalName: "Chara A",
        names: { ja_jp: "キャラA", en: "Chara A" },
        otherNames: ["別名A"],
        image: { large: "https://media.kitsu.app/l.png" },
      },
    ]);

    const result = await fetchKitsuCharacters(1234, fetchMock);
    expect(result).toEqual([
      {
        names: ["Chara A", "Chara A", "キャラA", "Chara A", "別名A"],
        imageUrl: "https://media.kitsu.app/l.png",
      },
    ]);
    // mappings → /anime/k1234/characters の順で呼ばれる
    const urls = fetchMock.mock.calls.map((c) => requestUrl(c[0]));
    expect(isKitsuMappingsUrl(urls[0]!)).toBe(true);
    expect(urls[1]).toContain("/anime/k1234/characters");
  });

  it("large が無ければ original / medium / small にフォールバックする", async () => {
    const fetchMock = mockFetch([
      {
        id: "c1",
        canonicalName: "キャラA",
        image: { large: null, original: "https://media.kitsu.app/o.png" },
      },
      {
        id: "c2",
        canonicalName: "キャラB",
        image: { medium: "https://media.kitsu.app/m.png" },
      },
      {
        id: "c3",
        canonicalName: "キャラC",
        image: { small: "https://media.kitsu.app/s.png" },
      },
    ]);
    const result = await fetchKitsuCharacters(1234, fetchMock);
    expect(result.map((c) => c.imageUrl)).toEqual([
      "https://media.kitsu.app/o.png",
      "https://media.kitsu.app/m.png",
      "https://media.kitsu.app/s.png",
    ]);
  });

  it("mediaCharacters 行が参照しない included のキャラクターは採用しない", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (isKitsuMappingsUrl(url)) return makeKitsuResponse({ m1234: {} });
      return new Response(
        JSON.stringify({
          data: [
            {
              type: "mediaCharacters",
              relationships: {
                character: { data: { type: "characters", id: "c1" } },
              },
            },
          ],
          included: [
            {
              id: "c1",
              type: "characters",
              attributes: { canonicalName: "キャラA" },
            },
            {
              id: "c9",
              type: "characters",
              attributes: { canonicalName: "無関係キャラ" },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const result = await fetchKitsuCharacters(1234, fetchMock);
    expect(result).toHaveLength(1);
    expect(result[0]?.names).toContain("キャラA");
  });

  it("mappings で見つからない MAL ID は空配列を返す（characters は叩かない）", async () => {
    const fetchMock = mockFetch([{ id: "c1", canonicalName: "キャラA" }], {
      mappingsFound: false,
    });
    const result = await fetchKitsuCharacters(1234, fetchMock);
    expect(result).toEqual([]);
    expect(
      fetchMock.mock.calls.every(
        (c) => !isKitsuCharactersUrl(requestUrl(c[0])),
      ),
    ).toBe(true);
  });

  it("非 2xx・ネットワーク失敗・壊れた JSON は空配列を返す（名簿応答を壊さない）", async () => {
    for (const impl of [
      vi.fn(async () => new Response("err", { status: 500 })),
      vi.fn(async () => {
        throw new Error("network down");
      }),
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (isKitsuMappingsUrl(url)) return makeKitsuResponse({ m1234: {} });
        return new Response("not json", { status: 200 });
      }),
    ]) {
      await expect(
        fetchKitsuCharacters(1234, impl as unknown as typeof fetch),
      ).resolves.toEqual([]);
    }
  });

  it("links.next を追って複数ページのキャラクターを回収する", async () => {
    const second =
      "https://kitsu.io/api/edge/anime/k1234/characters?page%5Boffset%5D=20";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (isKitsuMappingsUrl(url)) return makeKitsuResponse({ m1234: {} });
      if (url === second) {
        return makeKitsuCharactersResponse([
          { id: "c2", canonicalName: "キャラB" },
        ]);
      }
      return makeKitsuCharactersResponse(
        [{ id: "c1", canonicalName: "キャラA" }],
        second,
      );
    });
    const result = await fetchKitsuCharacters(1234, fetchMock);
    expect(result.map((c) => c.names[0])).toEqual(["キャラA", "キャラB"]);
  });

  it("この作品の characters 以外を指す links.next は追わない", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (isKitsuMappingsUrl(url)) return makeKitsuResponse({ m1234: {} });
      return makeKitsuCharactersResponse(
        [{ id: "c1", canonicalName: "キャラA" }],
        "https://evil.example.com/api/edge/anime/k1234/characters",
      );
    });
    await fetchKitsuCharacters(1234, fetchMock);
    // mappings 1 + characters 1 ページで終わる
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ページ数には上限がある（links.next が続いても 5 ページで打ち切る）", async () => {
    const next =
      "https://kitsu.io/api/edge/anime/k1234/characters?page%5Boffset%5D=20";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (isKitsuMappingsUrl(url)) return makeKitsuResponse({ m1234: {} });
      // 常に next を返して無限ページングを装う
      return makeKitsuCharactersResponse(
        [{ id: "c1", canonicalName: "キャラA" }],
        next,
      );
    });
    await fetchKitsuCharacters(1234, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1 + 5);
  });
});
