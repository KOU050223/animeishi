import { describe, it, expect } from "vitest";
import { workImageHtml } from "./service";

type Item = Parameters<typeof workImageHtml>[0];

function item(overrides: Partial<Item>): Item {
  return {
    annictWorkId: 42,
    resolvedImageUrl: null,
    imageUrl: null,
    ...overrides,
  };
}

describe("workImageHtml", () => {
  it("プロキシ URL を src に、残りの候補をすべて順に data-fallback へ載せる", () => {
    const html = workImageHtml(
      item({
        resolvedImageUrl: "https://s4.anilist.co/42.jpg",
        imageUrl: "https://official.example.com/og.png",
      }),
      "https://api.example.com/share/tier-lists/tok",
    );

    expect(html).toContain('src="https://api.example.com/images/works/42"');
    expect(html).toContain(
      'data-fallback="[&quot;https://s4.anilist.co/42.jpg&quot;,&quot;https://official.example.com/og.png&quot;]"',
    );
    expect(html).toContain("onerror=");
  });

  it("切り替え先が無ければ、失敗時は要素を消すだけ", () => {
    const html = workImageHtml(
      item({}),
      "https://api.example.com/share/tier-lists/tok",
    );

    expect(html).toContain('src="https://api.example.com/images/works/42"');
    expect(html).not.toContain("data-fallback");
    expect(html).toContain('onerror="this.remove()"');
  });

  it("onerror のスクリプトにユーザー由来の値を埋め込まない", () => {
    const html = workImageHtml(
      item({ imageUrl: "https://evil.example.com/x.png?'),alert(1)//" }),
      "https://api.example.com/share/tier-lists/tok",
    );
    const onerror = /onerror="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(onerror).not.toContain("evil.example.com");
  });
});
