import { describe, expect, it } from "vitest";
import { shouldDeferRouteRender } from "./shouldDeferRouteRender.web";

describe("Web の静的レンダリング", () => {
  it.each(["welcome", "privacy", "terms", "support"])(
    "公開ルート %s は Clerk の初期化前も描画する",
    (segment) => {
      expect(shouldDeferRouteRender(segment, false)).toBe(false);
    },
  );

  it("認証画面はサーバーで描画しない", () => {
    expect(shouldDeferRouteRender("(auth)", false)).toBe(true);
    expect(shouldDeferRouteRender("(tabs)", true)).toBe(true);
  });
});
