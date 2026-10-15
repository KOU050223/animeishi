import {
  isPlaceholderImageUrl,
  pickImageUrl,
  pickImageUrlCandidates,
} from "@/lib/anime/pickImageUrl";

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

  it("HTTP の画像 URL は HTTPS 画面で使えないため placeholder 扱い", () => {
    expect(isPlaceholderImageUrl("http://youjo-senki.jp/og-image.jpg")).toBe(
      true,
    );
  });
});

describe("pickImageUrl", () => {
  it("hostedImageUrl（R2 自前配信）があれば最優先で使う（issue #174）", () => {
    // Annict の実画像があっても、取り込み済みなら自前 URL を優先する
    expect(
      pickImageUrl({
        hostedImageUrl: "https://api.example.com/images/works/1/abc12345.png",
        imageUrl: "https://shonenjumpplus.com/uploads/original/1.png",
        resolvedImageUrl: "https://s4.anilist.co/1.jpg",
      }),
    ).toBe("https://api.example.com/images/works/1/abc12345.png");
    // http: の imageUrl でも R2 に取り込まれていれば https で配信される
    expect(
      pickImageUrl({
        hostedImageUrl: "https://api.example.com/images/works/2/abc12345.webp",
        imageUrl: "http://youjo-senki.jp/og-image.jpg",
      }),
    ).toBe("https://api.example.com/images/works/2/abc12345.webp");
  });

  it("hostedImageUrl が null なら従来の優先順位に落ちる", () => {
    expect(
      pickImageUrl({
        hostedImageUrl: null,
        imageUrl: "https://shonenjumpplus.com/uploads/original/1.png",
        resolvedImageUrl: "https://s4.anilist.co/1.jpg",
      }),
    ).toBe("https://shonenjumpplus.com/uploads/original/1.png");
  });

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

  it("imageUrl が HTTP なら resolvedImageUrl を使う", () => {
    expect(
      pickImageUrl({
        imageUrl: "http://youjo-senki.jp/og-image.jpg",
        resolvedImageUrl: "https://s4.anilist.co/media/anime/21613.jpg",
      }),
    ).toBe("https://s4.anilist.co/media/anime/21613.jpg");
  });

  it("HTTP の imageUrl しか無ければ Mixed Content 回避のため null", () => {
    expect(
      pickImageUrl({
        imageUrl: "http://youjo-senki.jp/og-image.jpg",
        resolvedImageUrl: null,
      }),
    ).toBeNull();
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

describe("pickImageUrlCandidates", () => {
  it("hosted → imageUrl → resolvedImageUrl → placeholder imageUrl の順で返す", () => {
    expect(
      pickImageUrlCandidates({
        hostedImageUrl: "https://api.example.com/images/works/1/a.png",
        imageUrl: "https://img.example.com/p.png",
        resolvedImageUrl: "https://s4.anilist.co/1.jpg",
      }),
    ).toEqual([
      "https://api.example.com/images/works/1/a.png",
      "https://img.example.com/p.png",
      "https://s4.anilist.co/1.jpg",
    ]);
    // hostedImageUrl 失敗時に外部 URL へ切り替えられるよう残っている
    expect(
      pickImageUrlCandidates({
        hostedImageUrl: "https://api.example.com/images/works/1/a.png",
        imageUrl: null,
        resolvedImageUrl: "https://s4.anilist.co/1.jpg",
      }),
    ).toEqual([
      "https://api.example.com/images/works/1/a.png",
      "https://s4.anilist.co/1.jpg",
    ]);
  });

  it("placeholder な imageUrl は resolved より後ろに回る", () => {
    expect(
      pickImageUrlCandidates({
        imageUrl: "https://pbs.twimg.com/1.jpg",
        resolvedImageUrl: "https://s4.anilist.co/1.jpg",
      }),
    ).toEqual(["https://s4.anilist.co/1.jpg", "https://pbs.twimg.com/1.jpg"]);
  });

  it("同一 URL の重複は除く / 全て無ければ空配列", () => {
    const url = "https://img.example.com/same.png";
    expect(
      pickImageUrlCandidates({ imageUrl: url, resolvedImageUrl: url }),
    ).toEqual([url]);
    expect(
      pickImageUrlCandidates({ hostedImageUrl: url, imageUrl: url }),
    ).toEqual([url]);
    expect(pickImageUrlCandidates({})).toEqual([]);
    expect(
      pickImageUrlCandidates({ imageUrl: "http://x.example.com/a.png" }),
    ).toEqual([]);
  });

  it("pickImageUrl は候補の先頭と一致する", () => {
    const item = {
      hostedImageUrl: "https://api.example.com/images/works/1/a.png",
      imageUrl: "https://img.example.com/p.png",
    };
    expect(pickImageUrl(item)).toBe(pickImageUrlCandidates(item)[0]);
  });
});
