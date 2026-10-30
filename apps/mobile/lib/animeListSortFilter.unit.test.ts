import { describe, expect, it } from "vitest";
import {
  ANIME_LIST_SORT_DEFAULT_ORDER,
  NO_ANIME_LIST_FILTERS,
  UNKNOWN_GENRE_KEY,
  animeListFilterCount,
  collectAnimeGenres,
  filterAnimeList,
  isAnimeListFilterActive,
  sortAnimeList,
} from "./animeListSortFilter";

function entry(
  annictWorkId: number,
  overrides: Partial<{
    title: string;
    seasonYear: number | null;
    watchersCount: number | null;
    media: string | null;
    genres: string[] | null;
  }> = {},
) {
  return {
    annictWorkId,
    title: `作品${annictWorkId}`,
    seasonYear: 2024,
    watchersCount: null,
    media: "TV",
    genres: null,
    ...overrides,
  };
}

describe("ANIME_LIST_SORT_DEFAULT_ORDER", () => {
  it("人気順は降順（多い順）、タイトル・年は昇順が既定", () => {
    expect(ANIME_LIST_SORT_DEFAULT_ORDER.watchersCount).toBe("desc");
    expect(ANIME_LIST_SORT_DEFAULT_ORDER.title).toBe("asc");
    expect(ANIME_LIST_SORT_DEFAULT_ORDER.year).toBe("asc");
  });
});

describe("sortAnimeList", () => {
  const list = [
    entry(1, { title: "進撃の巨人", watchersCount: 300 }),
    entry(2, { title: "鬼滅の刃", watchersCount: null }),
    entry(3, { title: "あいうえお", watchersCount: 900 }),
  ];

  it("watchersCount 降順は多い順で、未取得（null）は末尾に寄せる", () => {
    expect(
      sortAnimeList(list, "watchersCount", "desc").map((w) => w.annictWorkId),
    ).toEqual([3, 1, 2]);
  });

  it("watchersCount 昇順も null は末尾のまま", () => {
    // 「人気不明」が最不人気として先頭に来ないようにする
    expect(
      sortAnimeList(list, "watchersCount", "asc").map((w) => w.annictWorkId),
    ).toEqual([1, 3, 2]);
  });

  it("元の配列を破壊しない", () => {
    const original = [...list];
    sortAnimeList(list, "watchersCount", "desc");
    expect(list).toEqual(original);
  });
});

describe("collectAnimeGenres", () => {
  it("出現するジャンルを件数の多い順（同数は名前順）に並べる", () => {
    const items = [
      entry(1, { genres: ["Action", "Drama"] }),
      entry(2, { genres: ["Action"] }),
      entry(3, { genres: ["Comedy", "Action"] }),
    ];
    expect(collectAnimeGenres(items)).toEqual(["Action", "Comedy", "Drama"]);
  });

  it("ジャンル未取得（null）の作品があるときだけ「不明」を末尾に足す", () => {
    expect(
      collectAnimeGenres([
        entry(1, { genres: ["Action"] }),
        entry(2, { genres: null }),
      ]),
    ).toEqual(["Action", UNKNOWN_GENRE_KEY]);
    // 全件取得済みなら「不明」は出さない
    expect(collectAnimeGenres([entry(1, { genres: ["Action"] })])).toEqual([
      "Action",
    ]);
  });

  it("genres=[]（取得済みだが無い）は「不明」の根拠にしない", () => {
    expect(
      collectAnimeGenres([entry(1, { genres: [] }), entry(2, { genres: [] })]),
    ).toEqual([]);
  });
});

describe("filterAnimeList", () => {
  const items = [
    entry(1, { media: "TV", genres: ["Action", "Drama"] }),
    entry(2, { media: "MOVIE", genres: ["Action"] }),
    entry(3, { media: "TV", genres: null }),
    entry(4, { media: "OVA", genres: [] }),
    // media を持たない作品（取得経路違い）
    { annictWorkId: 5, title: "作品5", media: undefined, genres: ["Action"] },
  ];

  it("フィルタ無効時は全件返す", () => {
    expect(filterAnimeList(items, NO_ANIME_LIST_FILTERS)).toHaveLength(5);
  });

  it("メディア種別で絞る。media を持たない作品は落ちる", () => {
    const result = filterAnimeList(items, { media: "TV", genres: [] });
    expect(result.map((w) => w.annictWorkId)).toEqual([1, 3]);
  });

  it("ジャンルは複数選択でいずれか一致（OR）", () => {
    const result = filterAnimeList(items, {
      media: null,
      genres: ["Drama", "Comedy"],
    });
    expect(result.map((w) => w.annictWorkId)).toEqual([1]);
  });

  it("「不明」はジャンル未取得（null）の作品にだけ一致する", () => {
    const result = filterAnimeList(items, {
      media: null,
      genres: [UNKNOWN_GENRE_KEY],
    });
    // genres=[]（取得済みだが無い。id:4）は「不明」ではないので落ちる
    expect(result.map((w) => w.annictWorkId)).toEqual([3]);
  });

  it("メディアとジャンルの同時指定は AND になる", () => {
    const result = filterAnimeList(items, {
      media: "MOVIE",
      genres: ["Action"],
    });
    expect(result.map((w) => w.annictWorkId)).toEqual([2]);
  });
});

describe("isAnimeListFilterActive / animeListFilterCount", () => {
  it("未指定なら無効・0 件", () => {
    expect(isAnimeListFilterActive(NO_ANIME_LIST_FILTERS)).toBe(false);
    expect(animeListFilterCount(NO_ANIME_LIST_FILTERS)).toBe(0);
  });

  it("メディア 1 件 + ジャンル選択数をカウントする", () => {
    const filters = { media: "TV" as const, genres: ["Action", "Drama"] };
    expect(isAnimeListFilterActive(filters)).toBe(true);
    expect(animeListFilterCount(filters)).toBe(3);
  });
});
