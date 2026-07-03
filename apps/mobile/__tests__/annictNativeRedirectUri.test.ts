import { resolveNativeAnnictRedirectUri } from "@/lib/annict/useAnnictConnect.native";

describe("resolveNativeAnnictRedirectUri", () => {
  test("uses explicit env override when configured", () => {
    expect(
      resolveNativeAnnictRedirectUri({
        configuredRedirectUri: "exp://192.168.0.13:8081/--/annict",
        createURL: () => "animeishi://annict",
      }),
    ).toBe("exp://192.168.0.13:8081/--/annict");
  });

  test("falls back to Expo Linking URL", () => {
    expect(
      resolveNativeAnnictRedirectUri({
        configuredRedirectUri: "",
        createURL: (path) => `animeishi://${path}`,
      }),
    ).toBe("animeishi://annict");
  });
});
