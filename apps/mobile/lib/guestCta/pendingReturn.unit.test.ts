import { describe, expect, it } from "vitest";
import {
  PENDING_RETURN_TTL_MS,
  isReturnablePath,
  parsePendingReturn,
  profileReturnPath,
  serializePendingReturn,
} from "./pendingReturn";

const NOW = 1_800_000_000_000;

describe("isReturnablePath", () => {
  it("公開プロフィールのパスだけを戻り先として許す", () => {
    expect(isReturnablePath("/user/user_2abcXYZ-9")).toBe(true);
    expect(isReturnablePath("/")).toBe(false);
    expect(isReturnablePath("/user/")).toBe(false);
    expect(isReturnablePath("/user/a/b")).toBe(false);
    expect(isReturnablePath("https://evil.example.com/user/a")).toBe(false);
    expect(isReturnablePath("//evil.example.com/user/a")).toBe(false);
    expect(isReturnablePath("/delete-account")).toBe(false);
  });
});

describe("profileReturnPath", () => {
  it("uid から戻り先を作り、パスとして不正な uid は null にする", () => {
    expect(profileReturnPath("user_abc")).toBe("/user/user_abc");
    expect(profileReturnPath("../delete-account")).toBeNull();
    expect(profileReturnPath("")).toBeNull();
  });
});

describe("parsePendingReturn", () => {
  it("保存した戻り先を期限内なら取り出せる", () => {
    const raw = serializePendingReturn("/user/user_abc", NOW);
    expect(parsePendingReturn(raw, NOW + PENDING_RETURN_TTL_MS)).toBe(
      "/user/user_abc",
    );
  });

  it("期限切れ・未来時刻の記録は捨てる", () => {
    const raw = serializePendingReturn("/user/user_abc", NOW);
    expect(parsePendingReturn(raw, NOW + PENDING_RETURN_TTL_MS + 1)).toBeNull();
    expect(parsePendingReturn(raw, NOW - 1)).toBeNull();
  });

  it("壊れた値・許可外のパスは捨てる", () => {
    expect(parsePendingReturn(null, NOW)).toBeNull();
    expect(parsePendingReturn("not json", NOW)).toBeNull();
    expect(parsePendingReturn("null", NOW)).toBeNull();
    expect(
      parsePendingReturn(JSON.stringify({ path: "/user/a" }), NOW),
    ).toBeNull();
    expect(
      parsePendingReturn(serializePendingReturn("/delete-account", NOW), NOW),
    ).toBeNull();
  });
});
