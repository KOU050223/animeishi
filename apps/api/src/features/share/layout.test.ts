import { describe, it, expect } from "vitest";
import { html } from "#src/lib/html";
import { renderSharePage, statsHtml } from "./layout";

describe("renderSharePage のエスケープ（issue #716）", () => {
  it("title / heading / ownerLine 等に未エスケープの文字列を渡してもエスケープされる", () => {
    const page = renderSharePage({
      title: `<img src=x onerror="alert(1)">`,
      metaDescription: `desc "quoted" & 'apos'`,
      canonicalUrl: "https://animeishi.uomi.dev/share/x?a=1&b=2",
      kind: `<b>Tier</b>`,
      heading: `<script>alert(1)</script>`,
      ownerLine: `<svg onload=alert(1)>`,
      description: `line1\n<script>alert(2)</script>`,
      statsHtml: statsHtml([{ label: `<i>作品</i>`, value: 3 }]),
      bodyHtml: html`<p>body ${"<em>escaped</em>"}</p>`,
      guestCta: { source: "share_tier_list", label: `<u>作る</u>` },
    });

    expect(page).toContain(
      "<title>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</title>",
    );
    expect(page).toContain(
      'name="description" content="desc &quot;quoted&quot; &amp; &#39;apos&#39;"',
    );
    expect(page).toContain('<p class="kind">&lt;b&gt;Tier&lt;/b&gt;</p>');
    expect(page).toContain("<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>");
    expect(page).toContain('<p class="owner">&lt;svg onload=alert(1)&gt;</p>');
    expect(page).toContain(
      '<p class="description">line1\n&lt;script&gt;alert(2)&lt;/script&gt;</p>',
    );
    expect(page).toContain(
      "<li><strong>3</strong> &lt;i&gt;作品&lt;/i&gt;</li>",
    );
    expect(page).toContain("&lt;u&gt;作る&lt;/u&gt;</a>");
    expect(page).toContain(
      'rel="canonical" href="https://animeishi.uomi.dev/share/x?a=1&amp;b=2"',
    );
    expect(page).toContain("<p>body &lt;em&gt;escaped&lt;/em&gt;</p>");
    expect(page).not.toContain("<script>");
  });

  it("bodyHtml / statsHtml / pageCss は HtmlEscapedString を要求する", () => {
    renderSharePage({
      title: "t",
      kind: "k",
      heading: "h",
      // @ts-expect-error 未エスケープの string は bodyHtml に渡せない
      bodyHtml: "<p>not escaped</p>",
      // @ts-expect-error 未エスケープの string は statsHtml に渡せない
      statsHtml: "<ul></ul>",
      // @ts-expect-error 未エスケープの string は pageCss に渡せない
      pageCss: "p { color: red; }",
    });
  });
});
