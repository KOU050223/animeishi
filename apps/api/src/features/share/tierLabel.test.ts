import { describe, it, expect } from "vitest";
import { buildSharedCustomTierListHtml } from "./service";

function render(color: string): string {
  return buildSharedCustomTierListHtml(
    {
      title: "表",
      description: null,
      ownerUsername: "u",
      tiersJson: JSON.stringify([{ key: "s", label: "S", color }]),
      items: [],
    },
    "http://localhost/share/tier-lists/t",
    "http://localhost/share/tier-lists/t",
  );
}

describe("共有ページの tier ラベル色", () => {
  it("16 進カラーはそのまま背景色に使う", () => {
    expect(render("#ff7f7f")).toContain("background-color: #ff7f7f;");
  });

  it("16 進カラー以外は style に宣言を足せないよう既定色にする", () => {
    const html = render("red; position: fixed; inset: 0");
    // ページ共通の CSS（下部固定 CTA）にも position: fixed があるため、
    // ラベルの style 属性だけを見る。
    const labelStyle =
      /<div class="tier-label" style="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(labelStyle).not.toContain("position: fixed");
    expect(labelStyle).toContain("background-color: #e2e8f0;");
  });
});
