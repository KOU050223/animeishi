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
    "http://localhost/share/custom-tier-lists/t",
    "http://localhost/share/custom-tier-lists/t",
  );
}

describe("共有ページの tier ラベル色", () => {
  it("16 進カラーはそのまま背景色に使う", () => {
    expect(render("#ff7f7f")).toContain("background-color: #ff7f7f;");
  });

  it("16 進カラー以外は style に宣言を足せないよう既定色にする", () => {
    const html = render("red; position: fixed; inset: 0");
    expect(html).not.toContain("position: fixed");
    expect(html).toContain("background-color: #e2e8f0;");
  });
});
