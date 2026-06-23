import { nextFavoriteAction } from "@/lib/useFavorites";

describe("nextFavoriteAction", () => {
  it("未登録の animeId は add を返す", () => {
    const favoriteIds = new Set<number>([1, 2, 3]);
    expect(nextFavoriteAction(favoriteIds, 99)).toBe("add");
  });

  it("登録済みの animeId は remove を返す", () => {
    const favoriteIds = new Set<number>([1, 2, 3]);
    expect(nextFavoriteAction(favoriteIds, 2)).toBe("remove");
  });

  it("空の Set ではどの animeId も add を返す", () => {
    const favoriteIds = new Set<number>();
    expect(nextFavoriteAction(favoriteIds, 1)).toBe("add");
  });
});
