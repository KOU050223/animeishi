import { describe, expect, it } from "vitest";
import { resolveEnvironment } from "./environment";

describe("resolveEnvironment", () => {
  it.each(["production", "preview", "development"] as const)(
    "既知の値 %s はそのまま返す",
    (env) => {
      expect(resolveEnvironment(env)).toBe(env);
    },
  );

  it.each([undefined, "", "staging", "Production", "prd"])(
    "未知・未設定の値 %s は development に倒す",
    (raw) => {
      expect(resolveEnvironment(raw)).toBe("development");
    },
  );
});
