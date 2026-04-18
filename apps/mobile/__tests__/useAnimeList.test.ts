import { renderHook } from "@testing-library/react-native";
import { useFilteredAnimeList } from "@/lib/useAnimeList";

const MOCK_TITLES = [
  {
    id: 1,
    title: "進撃の巨人",
    titleReading: "しんげきのきょじん",
    titleEnglish: "Attack on Titan",
    year: 2013,
    season: "spring",
    genres: ["アクション", "ファンタジー"],
    thumbnailUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 2,
    title: "鬼滅の刃",
    titleReading: "きめつのやいば",
    titleEnglish: "Demon Slayer",
    year: 2019,
    season: "spring",
    genres: ["アクション"],
    thumbnailUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 3,
    title: "HUNTER×HUNTER",
    titleReading: "はんたーはんたー",
    titleEnglish: "Hunter x Hunter",
    year: 2011,
    season: "fall",
    genres: ["アクション", "アドベンチャー"],
    thumbnailUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

describe("useFilteredAnimeList", () => {
  describe("検索フィルタリング", () => {
    it("クエリなしで全件返す", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "", "title", "asc")
      );
      expect(result.current).toHaveLength(3);
    });

    it("タイトルで絞り込む", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "鬼滅", "title", "asc")
      );
      expect(result.current).toHaveLength(1);
      expect(result.current[0].title).toBe("鬼滅の刃");
    });

    it("よみがなで絞り込む", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "しんげき", "title", "asc")
      );
      expect(result.current).toHaveLength(1);
      expect(result.current[0].title).toBe("進撃の巨人");
    });

    it("英語タイトルで絞り込む", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "demon", "title", "asc")
      );
      expect(result.current).toHaveLength(1);
      expect(result.current[0].title).toBe("鬼滅の刃");
    });

    it("一致なしで空配列を返す", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "存在しないタイトル", "title", "asc")
      );
      expect(result.current).toHaveLength(0);
    });

    it("空白のみのクエリは全件返す", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "   ", "title", "asc")
      );
      expect(result.current).toHaveLength(3);
    });
  });

  describe("ソート", () => {
    it("タイトル昇順でソートする", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "", "title", "asc")
      );
      const titles = result.current.map((a) => a.title);
      expect(titles).toEqual(["HUNTER×HUNTER", "鬼滅の刃", "進撃の巨人"]);
    });

    it("タイトル降順でソートする", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "", "title", "desc")
      );
      const titles = result.current.map((a) => a.title);
      expect(titles).toEqual(["進撃の巨人", "鬼滅の刃", "HUNTER×HUNTER"]);
    });

    it("年度昇順でソートする", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "", "year", "asc")
      );
      const years = result.current.map((a) => a.year);
      expect(years).toEqual([2011, 2013, 2019]);
    });

    it("年度降順でソートする", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(MOCK_TITLES, "", "year", "desc")
      );
      const years = result.current.map((a) => a.year);
      expect(years).toEqual([2019, 2013, 2011]);
    });
  });

  describe("エッジケース", () => {
    it("data が undefined のとき空配列を返す", () => {
      const { result } = renderHook(() =>
        useFilteredAnimeList(undefined, "", "title", "asc")
      );
      expect(result.current).toHaveLength(0);
    });
  });
});
