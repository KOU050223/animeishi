import { describe, it, expect } from "vitest";
import {
  profileUpdateSchema,
  watchHistoryUpsertSchema,
  VALID_GENRES,
  ANNICT_STATUS_STATES,
} from "@/schema/validators";

// ---- profileUpdateSchema ----
describe("profileUpdateSchema", () => {
  it("全フィールド省略（空オブジェクト）を受け入れる", () => {
    expect(profileUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("有効なプロフィール更新を受け入れる", () => {
    expect(
      profileUpdateSchema.safeParse({
        username: "newname",
        selectedGenres: ["アクション", "SF"],
        isPublic: true,
      }).success,
    ).toBe(true);
  });

  it("有効なbioを受け入れる", () => {
    expect(
      profileUpdateSchema.safeParse({ bio: "好きなアニメを集めています" })
        .success,
    ).toBe(true);
  });

  it("無効なジャンルを含む場合を拒否する", () => {
    expect(
      profileUpdateSchema.safeParse({
        selectedGenres: ["無効なジャンル"],
      }).success,
    ).toBe(false);
  });

  it("16個以上のジャンルを拒否する", () => {
    // VALID_GENRES(15個) + 重複を加えて16個にする
    expect(
      profileUpdateSchema.safeParse({
        selectedGenres: [...VALID_GENRES, "アクション"],
      }).success,
    ).toBe(false);
  });

  it("15個のジャンルを受け入れる", () => {
    expect(
      profileUpdateSchema.safeParse({
        selectedGenres: [...VALID_GENRES],
      }).success,
    ).toBe(true);
  });

  it("1文字のusernameを拒否する", () => {
    expect(profileUpdateSchema.safeParse({ username: "a" }).success).toBe(
      false,
    );
  });

  it("21文字以上のusernameを拒否する", () => {
    expect(
      profileUpdateSchema.safeParse({ username: "a".repeat(21) }).success,
    ).toBe(false);
  });

  it("予約語 admin をusernameとして拒否する", () => {
    expect(profileUpdateSchema.safeParse({ username: "admin" }).success).toBe(
      false,
    );
  });

  it("501文字以上のbioを拒否する", () => {
    expect(
      profileUpdateSchema.safeParse({ bio: "あ".repeat(501) }).success,
    ).toBe(false);
  });

  it("不適切な言葉を含むbioを拒否する", () => {
    expect(profileUpdateSchema.safeParse({ bio: "死ねと思う" }).success).toBe(
      false,
    );
  });

  it("URLを含むfavoriteQuoteを拒否する", () => {
    expect(
      profileUpdateSchema.safeParse({
        favoriteQuote: "見てhttps://example.com",
      }).success,
    ).toBe(false);
  });
});

// ---- watchHistoryUpsertSchema ----
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
