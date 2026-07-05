import { isPlaceholderImageUrl, pickImageUrl } from "@/lib/anime/pickImageUrl";

describe("isPlaceholderImageUrl", () => {
  it("null / undefined / 空文字は placeholder", () => {
    expect(isPlaceholderImageUrl(null)).toBe(true);
    expect(isPlaceholderImageUrl(undefined)).toBe(true);
    expect(isPlaceholderImageUrl("")).toBe(true);
    expect(isPlaceholderImageUrl("   ")).toBe(true);
  });

  it("Twitter / Facebook のアバター URL は placeholder", () => {
    expect(
      isPlaceholderImageUrl(
        "https://pbs.twimg.com/profile_images/1/avatar.jpg",
      ),
    ).toBe(true);
    expect(
      isPlaceholderImageUrl("https://graph.facebook.com/1/picture?type=large"),
    ).toBe(true);
  });

  it("Annict / AniList / MAL の URL は非 placeholder", () => {
    expect(
      isPlaceholderImageUrl(
        "https://shonenjumpplus.com/uploads/original/work/1/main_pc.png",
      ),
    ).toBe(false);
    expect(
      isPlaceholderImageUrl("https://s4.anilist.co/media/anime/1.jpg"),
    ).toBe(false);
    expect(isPlaceholderImageUrl("https://cdn.myanimelist.net/1.jpg")).toBe(
      false,
    );
  });
});

describe("pickImageUrl", () => {
  it("Annict imageUrl が非 placeholder なら imageUrl を優先", () => {
    expect(
      pickImageUrl({
        imageUrl: "https://shonenjumpplus.com/uploads/original/1.png",
        resolvedImageUrl: "https://s4.anilist.co/1.jpg",
      }),
    ).toBe("https://shonenjumpplus.com/uploads/original/1.png");
  });

  it("imageUrl が SNS placeholder なら resolvedImageUrl を使う", () => {
    expect(
      pickImageUrl({
        imageUrl: "https://pbs.twimg.com/profile_images/1/avatar.jpg",
        resolvedImageUrl: "https://s4.anilist.co/1.jpg",
      }),
    ).toBe("https://s4.anilist.co/1.jpg");
  });

  it("imageUrl が null なら resolvedImageUrl を使う", () => {
    expect(
      pickImageUrl({
        imageUrl: null,
        resolvedImageUrl: "https://cdn.myanimelist.net/2.jpg",
      }),
    ).toBe("https://cdn.myanimelist.net/2.jpg");
  });

  it("resolvedImageUrl が無ければ placeholder でも imageUrl を返す（無いよりマシ）", () => {
    expect(
      pickImageUrl({
        imageUrl: "https://pbs.twimg.com/1.jpg",
        resolvedImageUrl: null,
      }),
    ).toBe("https://pbs.twimg.com/1.jpg");
  });

  it("両方無ければ null", () => {
    expect(pickImageUrl({ imageUrl: null, resolvedImageUrl: null })).toBeNull();
    expect(pickImageUrl({})).toBeNull();
  });
});
