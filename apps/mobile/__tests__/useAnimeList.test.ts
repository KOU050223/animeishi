import { renderHook } from "@testing-library/react-native";
import { useSortedAnimeList } from "@/lib/useAnimeList";

const MOCK_WORKS = [
  {
    annictWorkId: 1,
    nodeId: "node-1",
    state: null,
    title: "進撃の巨人",
    titleKana: "しんげきのきょじん",
    titleEn: "Attack on Titan",
    seasonYear: 2013,
    seasonName: "2013-spring",
    imageUrl: null,
  },
  {
    annictWorkId: 2,
    nodeId: "node-2",
    state: null,
    title: "鬼滅の刃",
    titleKana: "きめつのやいば",
    titleEn: "Demon Slayer",
    seasonYear: 2019,
    seasonName: "2019-spring",
    imageUrl: null,
  },
  {
    annictWorkId: 3,
    nodeId: "node-3",
    state: null,
    title: "HUNTER×HUNTER",
    titleKana: "はんたーはんたー",
    titleEn: "Hunter x Hunter",
    seasonYear: 2011,
    seasonName: "2011-fall",
    imageUrl: null,
  },
];

describe("useSortedAnimeList", () => {
  describe("ソート", () => {
    it("タイトル昇順でソートする", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "title", "asc")
      );
      const titles = result.current.map((a) => a.title);
      expect(titles).toEqual(["HUNTER×HUNTER", "鬼滅の刃", "進撃の巨人"]);
    });

    it("タイトル降順でソートする", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "title", "desc")
      );
      const titles = result.current.map((a) => a.title);
      expect(titles).toEqual(["進撃の巨人", "鬼滅の刃", "HUNTER×HUNTER"]);
    });

    it("年度昇順でソートする", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "year", "asc")
      );
      const years = result.current.map((a) => a.seasonYear);
      expect(years).toEqual([2011, 2013, 2019]);
    });

    it("年度降順でソートする", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "year", "desc")
      );
      const years = result.current.map((a) => a.seasonYear);
      expect(years).toEqual([2019, 2013, 2011]);
    });

    it("元の配列を破壊しない", () => {
      const original = [...MOCK_WORKS];
      renderHook(() => useSortedAnimeList(MOCK_WORKS, "title", "asc"));
      expect(MOCK_WORKS).toEqual(original);
    });
  });

  describe("エッジケース", () => {
    it("data が undefined のとき空配列を返す", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(undefined, "title", "asc")
      );
      expect(result.current).toHaveLength(0);
    });
  });
});
