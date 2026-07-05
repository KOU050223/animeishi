import { buildProfileUrl } from "@/lib/profileUrl/profileUrl.web";

describe("buildProfileUrl (web)", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { origin: "http://localhost:8081" },
      configurable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      configurable: true,
    });
  });

  it("現在の origin から公開プロフィール URL を組み立てる", () => {
    expect(buildProfileUrl("user_abc123")).toBe(
      "http://localhost:8081/user/user_abc123",
    );
  });

  it("userId がない場合は null を返す", () => {
    expect(buildProfileUrl(null)).toBeNull();
  });
});
