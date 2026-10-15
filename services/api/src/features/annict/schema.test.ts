import { describe, it, expect } from "vitest";
import { annictExchangeSchema } from "./schema";

describe("annictExchangeSchema", () => {
  it("deep link の redirect_uri を mode:native で受け入れる", () => {
    expect(
      annictExchangeSchema.safeParse({
        code: "abc",
        redirectUri: "animeishi://annict",
        mode: "native",
      }).success,
    ).toBe(true);
  });

  it("Web (http) の redirect_uri を mode:web で受け入れる", () => {
    expect(
      annictExchangeSchema.safeParse({
        code: "abc",
        redirectUri: "http://localhost:8081/annict",
        mode: "web",
      }).success,
    ).toBe(true);
  });

  it("mode 未指定は拒否する（fail-open 防止のため必須）", () => {
    expect(
      annictExchangeSchema.safeParse({
        code: "abc",
        redirectUri: "animeishi://annict",
      }).success,
    ).toBe(false);
  });

  it("Web (http) の redirect_uri で mode:native は拒否する（トークン漏洩防止）", () => {
    expect(
      annictExchangeSchema.safeParse({
        code: "abc",
        redirectUri: "https://animeishi.uomi.dev/annict",
        mode: "native",
      }).success,
    ).toBe(false);
  });

  it("URI 形式でない redirect_uri を拒否する", () => {
    expect(
      annictExchangeSchema.safeParse({
        code: "abc",
        redirectUri: "not a uri",
        mode: "native",
      }).success,
    ).toBe(false);
  });

  it("code が空文字なら拒否する", () => {
    expect(
      annictExchangeSchema.safeParse({
        code: "",
        redirectUri: "animeishi://annict",
        mode: "native",
      }).success,
    ).toBe(false);
  });
});
