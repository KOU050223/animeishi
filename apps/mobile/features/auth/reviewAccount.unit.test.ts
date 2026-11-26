import { describe, it, expect, vi } from "vitest";
import { isReviewAccountEmail } from "@/features/auth/reviewAccount";

// reviewAccount は API クライアントを import する（vi.mock は先頭へ巻き上げられる）。
vi.mock("@/lib/api", () => ({ apiClient: {} }));

describe("isReviewAccountEmail", () => {
  it("設定されたアドレスと一致すればデモアカウントとみなす", () => {
    expect(
      isReviewAccountEmail("review@example.com", "review@example.com"),
    ).toBe(true);
  });

  it("大文字小文字と前後の空白の違いは無視する", () => {
    expect(
      isReviewAccountEmail(" Review@Example.com ", "review@example.com"),
    ).toBe(true);
  });

  it("別のアドレスはデモアカウントとみなさない", () => {
    expect(isReviewAccountEmail("user@example.com", "review@example.com")).toBe(
      false,
    );
  });

  it("デモアカウントが未設定の環境では常に false", () => {
    expect(isReviewAccountEmail("review@example.com", undefined)).toBe(false);
    expect(isReviewAccountEmail("", "")).toBe(false);
  });
});
