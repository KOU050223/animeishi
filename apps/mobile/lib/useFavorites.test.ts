import { nextFavoriteAction, matchesFavoriteQuery } from "@/lib/useFavorites";

describe("matchesFavoriteQuery", () => {
  const favorite = {
    title: "Re:ゼロから始める異世界生活",
    titleKana: "リゼロカラハジメルイセカイセイカツ",
    titleEn: "Re:Zero − Starting Life in Another World",
  };

  it("title の部分一致でマッチする", () => {
    expect(matchesFavoriteQuery(favorite, "異世界")).toBe(true);
  });

  it("title に含まれる英字部分は大文字小文字を無視してマッチする", () => {
    expect(matchesFavoriteQuery(favorite, "re:ゼロ")).toBe(true);
  });

  it("titleEn の大文字小文字を無視してマッチする", () => {
    expect(matchesFavoriteQuery(favorite, "starting life")).toBe(true);
  });

  it("ひらがな入力でも titleKana(カタカナ) にマッチする", () => {
    expect(matchesFavoriteQuery(favorite, "りぜろ")).toBe(true);
  });

  it("どのフィールドにも一致しなければ false", () => {
    expect(matchesFavoriteQuery(favorite, "ワンピース")).toBe(false);
  });

  it("空文字クエリは true を返す", () => {
    expect(matchesFavoriteQuery(favorite, "")).toBe(true);
  });
});

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
