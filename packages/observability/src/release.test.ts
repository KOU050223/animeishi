import { describe, expect, it } from "vitest";
import { buildRelease } from "./release";

describe("buildRelease", () => {
  it("api は animeishi-api@<id> 形式になる", () => {
    expect(buildRelease("api", "abc123")).toBe("animeishi-api@abc123");
  });

  it("mobile は animeishi-mobile@<id> 形式になる", () => {
    expect(buildRelease("mobile", "1.2.3")).toBe("animeishi-mobile@1.2.3");
  });
});
