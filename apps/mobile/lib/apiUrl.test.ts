import { resolveApiUrl } from "@/lib/apiUrl";

describe("resolveApiUrl", () => {
  test("keeps configured localhost on web", () => {
    expect(
      resolveApiUrl({
        configuredUrl: "http://localhost:8787",
        platformOS: "web",
        hostUri: "192.168.0.13:8081",
      }),
    ).toBe("http://localhost:8787");
  });

  test("rewrites localhost to Expo host on native", () => {
    expect(
      resolveApiUrl({
        configuredUrl: "http://localhost:8787",
        platformOS: "ios",
        hostUri: "192.168.0.13:8081",
      }),
    ).toBe("http://192.168.0.13:8787");
  });

  test("keeps explicit non-loopback API URLs", () => {
    expect(
      resolveApiUrl({
        configuredUrl: "https://animeishi-api.uomi.dev",
        platformOS: "ios",
        hostUri: "192.168.0.13:8081",
      }),
    ).toBe("https://animeishi-api.uomi.dev");
  });
});
