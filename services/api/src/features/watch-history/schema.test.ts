import { describe, it, expect } from "vitest";
import { ANNICT_STATUS_STATES } from "@/lib/annict/statusState";
import { watchHistoryUpsertSchema } from "./schema";

describe("watchHistoryUpsertSchema", () => {
  it("有効な Annict ステータスを受け入れる", () => {
    for (const state of ANNICT_STATUS_STATES) {
      expect(watchHistoryUpsertSchema.safeParse({ state }).success).toBe(true);
    }
  });

  it("無効なステータスを拒否する", () => {
    expect(
      watchHistoryUpsertSchema.safeParse({ state: "invalid" }).success,
    ).toBe(false);
  });

  it("旧ステータス値（watching）を拒否する", () => {
    expect(
      watchHistoryUpsertSchema.safeParse({ state: "watching" }).success,
    ).toBe(false);
  });

  it("旧ステータス値（completed）を拒否する", () => {
    expect(
      watchHistoryUpsertSchema.safeParse({ state: "completed" }).success,
    ).toBe(false);
  });

  it("state フィールドが必須", () => {
    expect(watchHistoryUpsertSchema.safeParse({}).success).toBe(false);
  });
});
