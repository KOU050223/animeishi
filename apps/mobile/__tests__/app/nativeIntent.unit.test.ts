import { describe, expect, it } from "vitest";
import { redirectSystemPath } from "@/app/+native-intent";

describe("redirectSystemPath", () => {
  it("expo-sharing のディープリンクを共有受け取り画面に振り替える", () => {
    expect(redirectSystemPath({ path: "animeishi://expo-sharing" })).toBe(
      "/incoming-share",
    );
  });

  it("QR の名刺 URL など他のディープリンクは素通しする", () => {
    const path = "animeishi://user/user_2abcDEF1234567890ghijKLMN";
    expect(redirectSystemPath({ path })).toBe(path);
  });

  it("パース不能なパスもそのまま返して既定の処理に委ねる", () => {
    expect(redirectSystemPath({ path: "not a url" })).toBe("not a url");
  });
});
