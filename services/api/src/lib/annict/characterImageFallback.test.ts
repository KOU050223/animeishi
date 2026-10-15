import { describe, it, expect, vi } from "vitest";
import {
  fetchAnilistCharacters,
  matchCharacterImages,
  normalizeCharacterName,
  type AnilistCharacter,
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

const anilist = (
  names: string[],
  imageUrl: string | null = "https://img.example/c.png",
): AnilistCharacter => ({ names, imageUrl });

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
      [anilist(["山田太郎"]), anilist(["別人"])],
    );
    expect(result.get(1)).toBe("https://img.example/c.png");
    expect(result.has(2)).toBe(false);
  });

  it("nameKana / nameEn も照合に使う", () => {
    const result = matchCharacterImages(
      [annict(1, "不明", "ヤマダタロウ"), annict(2, "不明2", null, "Hanako")],
      [anilist(["やまだ たろう"]), anilist(["hanako"])],
    );
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
  });

  it("Annict 側が nameKana/nameEn null を返しても落ちない", () => {
    const result = matchCharacterImages(
      [annict(1, "キャラA", null, null)],
      [anilist(["キャラA"])],
    );
    expect(result.has(1)).toBe(true);
  });

  it("「本名（通称）」表記は括弧を外した名前でも一致する", () => {
    const result = matchCharacterImages(
      [annict(1, "桜内梨子（りこちゃん）")],
      [anilist(["桜内梨子"])],
    );
    expect(result.has(1)).toBe(true);
  });

  it("AniList 側で同名キャラが複数いるキーは ambiguous として除外する", () => {
    const a = anilist(["双子A"], "https://img.example/a.png");
    const b = anilist(["双子A"], "https://img.example/b.png");
    const result = matchCharacterImages([annict(1, "双子A")], [a, b]);
    expect(result.has(1)).toBe(false);
  });

  it("1 人の AniList キャラが複数の Annict キャラに割り当たった場合は両方とも採用しない", () => {
    // どちらかが誤マッチなので、誤って別キャラの顔を出すより両方外す。
    const shared = anilist(["キャラA", "キャラA（本名）"]);
    const result = matchCharacterImages(
      [annict(1, "キャラA"), annict(2, "キャラA（本名）")],
      [shared],
    );
    expect(result.has(1)).toBe(false);
    expect(result.has(2)).toBe(false);
  });

  it("imageUrl が無い AniList キャラにマッチしても結果に含めない", () => {
    const result = matchCharacterImages(
      [annict(1, "キャラA")],
      [anilist(["キャラA"], null)],
    );
    expect(result.has(1)).toBe(false);
  });
});

describe("fetchAnilistCharacters", () => {
  const okResponse = (data: unknown) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("Media.characters の nodes を名前候補つきで返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          Media: {
            characters: {
              nodes: [
                {
                  name: {
                    native: "キャラA",
                    full: "Chara A",
                    alternative: ["別名A"],
                  },
                  image: { large: "https://img.example/l.png", medium: "m" },
                },
              ],
            },
          },
        },
      }),
    );

    const result = await fetchAnilistCharacters(1234, fetchMock);
    expect(result).toEqual([
      {
        names: ["キャラA", "Chara A", "別名A"],
        imageUrl: "https://img.example/l.png",
      },
    ]);
    // MAL ID で問い合わせる
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.variables.idMal).toBe(1234);
  });

  it("large が無ければ medium にフォールバックする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          Media: {
            characters: {
              nodes: [
                {
                  name: { native: "キャラA" },
                  image: { large: null, medium: "https://img.example/m.png" },
                },
              ],
            },
          },
        },
      }),
    );
    const result = await fetchAnilistCharacters(1, fetchMock);
    expect(result[0].imageUrl).toBe("https://img.example/m.png");
  });

  it("非 2xx・ネットワーク失敗・壊れた JSON は空配列を返す（名簿応答を壊さない）", async () => {
    for (const impl of [
      vi.fn().mockResolvedValue(new Response("err", { status: 500 })),
      vi.fn().mockRejectedValue(new Error("network down")),
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    ]) {
      await expect(fetchAnilistCharacters(1, impl)).resolves.toEqual([]);
    }
  });

  it("Media が無い応答も空配列を返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: {} }));
    await expect(fetchAnilistCharacters(1, fetchMock)).resolves.toEqual([]);
  });
});
