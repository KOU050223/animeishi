import { describe, expect, it } from "vitest";
import { decodeNearbyMessage, encodeNearbyMessage } from "./messages";

describe("nearby messages", () => {
  it("交換データと申し込みの合図をラウンドトリップできる", () => {
    for (const message of [
      { kind: "data", url: "https://example.com/user/x?qt=t" } as const,
      { kind: "request" } as const,
      { kind: "accept" } as const,
      { kind: "decline" } as const,
      { kind: "cancel" } as const,
    ]) {
      expect(decodeNearbyMessage(encodeNearbyMessage(message))).toEqual(
        message,
      );
    }
  });

  it("壊れた・版の違う・知らない種類のメッセージは無視する", () => {
    expect(decodeNearbyMessage("https://example.com/user/x?qt=t")).toBeNull();
    expect(decodeNearbyMessage("{")).toBeNull();
    expect(
      decodeNearbyMessage(JSON.stringify({ v: 2, kind: "request" })),
    ).toBeNull();
    expect(
      decodeNearbyMessage(JSON.stringify({ v: 1, kind: "hello" })),
    ).toBeNull();
    expect(
      decodeNearbyMessage(JSON.stringify({ v: 1, kind: "data" })),
    ).toBeNull();
  });
});
