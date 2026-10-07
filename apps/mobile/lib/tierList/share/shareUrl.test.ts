import { apiUrl } from "@/lib/apiUrl";
import { buildTierListShareUrl } from "./shareUrl";

describe("buildTierListShareUrl", () => {
  it("API の共有エンドポイント形式の URL を組み立てる", () => {
    const url = buildTierListShareUrl("abc-123");
    expect(url).toBe(`${apiUrl}/share/tier-lists/abc-123`);
  });

  it("トークンは URL エンコードされる", () => {
    const url = buildTierListShareUrl("a/b?c");
    expect(url).toContain(encodeURIComponent("a/b?c"));
  });
});
