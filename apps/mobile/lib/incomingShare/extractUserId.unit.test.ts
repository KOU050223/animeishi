import { describe, expect, it } from "vitest";
import { extractUserIdFromSharedText } from "@/lib/incomingShare/extractUserId";

const WEB_BASE = "https://animeishi.uomi.dev";
const CLERK_ID = "user_2abcDEF1234567890ghijKLMN";
const LEGACY_UID = "AbCdEf0123456789GhIjKlMnOpQr"; // 28 文字

describe("extractUserIdFromSharedText", () => {
  describe("Animeishi 名刺 URL", () => {
    it("Web 名刺 URL（{webBase}/user/{uid}）から抽出する", () => {
      expect(
        extractUserIdFromSharedText(`${WEB_BASE}/user/${CLERK_ID}`, WEB_BASE),
      ).toBe(CLERK_ID);
    });

    it("クエリ・フラグメント・末尾スラッシュを無視する", () => {
      expect(
        extractUserIdFromSharedText(
          `${WEB_BASE}/user/${CLERK_ID}/?from=share#top`,
          WEB_BASE,
        ),
      ).toBe(CLERK_ID);
    });

    it("animeishi://user/{uid} から抽出する", () => {
      expect(
        extractUserIdFromSharedText(`animeishi://user/${CLERK_ID}`, WEB_BASE),
      ).toBe(CLERK_ID);
    });

    it("animeishi://{uid} から抽出する", () => {
      expect(
        extractUserIdFromSharedText(`animeishi://${LEGACY_UID}`, WEB_BASE),
      ).toBe(LEGACY_UID);
    });

    it("生 UID（Clerk ID / 旧 UID）をそのまま受理する", () => {
      expect(extractUserIdFromSharedText(CLERK_ID, WEB_BASE)).toBe(CLERK_ID);
      expect(extractUserIdFromSharedText(LEGACY_UID, WEB_BASE)).toBe(
        LEGACY_UID,
      );
    });

    it("文に埋め込まれた名刺 URL を拾う", () => {
      expect(
        extractUserIdFromSharedText(
          `この名刺を見て ${WEB_BASE}/user/${CLERK_ID} だよ`,
          WEB_BASE,
        ),
      ).toBe(CLERK_ID);
    });
  });

  describe("Animeishi 以外の共有は null（エラー表示にする）", () => {
    it("別ホストの /user/{uid} URL は受理しない", () => {
      expect(
        extractUserIdFromSharedText(
          `https://example.com/user/${CLERK_ID}`,
          WEB_BASE,
        ),
      ).toBeNull();
    });

    it("名刺ホストでも /user/{uid} 以外のパスは受理しない", () => {
      expect(
        extractUserIdFromSharedText(`${WEB_BASE}/user`, WEB_BASE),
      ).toBeNull();
      expect(
        extractUserIdFromSharedText(
          `${WEB_BASE}/user/${CLERK_ID}/tier-list`,
          WEB_BASE,
        ),
      ).toBeNull();
      expect(
        extractUserIdFromSharedText(`${WEB_BASE}/about`, WEB_BASE),
      ).toBeNull();
    });

    it("他アプリのスキーム URL は受理しない", () => {
      expect(
        extractUserIdFromSharedText(`otherapp://user/${CLERK_ID}`, WEB_BASE),
      ).toBeNull();
    });

    it("UID 形式でない /user/ セグメントは受理しない", () => {
      expect(
        extractUserIdFromSharedText(`${WEB_BASE}/user/not-a-uid`, WEB_BASE),
      ).toBeNull();
    });

    it("ただのテキストは受理しない", () => {
      expect(
        extractUserIdFromSharedText("よろしくお願いします", WEB_BASE),
      ).toBeNull();
    });
  });

  describe("不正な入力", () => {
    it("null/undefined・空・空白のみは null", () => {
      expect(extractUserIdFromSharedText(null, WEB_BASE)).toBeNull();
      expect(extractUserIdFromSharedText(undefined, WEB_BASE)).toBeNull();
      expect(extractUserIdFromSharedText("", WEB_BASE)).toBeNull();
      expect(extractUserIdFromSharedText("   ", WEB_BASE)).toBeNull();
    });
  });

  describe("webBaseUrl 未設定（EXPO_PUBLIC_WEB_URL なしのビルド）", () => {
    it("未設定時は本番ホスト（animeishi.uomi.dev）の名刺 URL を受理する", () => {
      expect(
        extractUserIdFromSharedText(`${WEB_BASE}/user/${CLERK_ID}`, null),
      ).toBe(CLERK_ID);
      expect(
        extractUserIdFromSharedText(`animeishi://user/${CLERK_ID}`, null),
      ).toBe(CLERK_ID);
      expect(extractUserIdFromSharedText(CLERK_ID, null)).toBe(CLERK_ID);
    });

    it("未設定でも任意ホストは受理しない", () => {
      expect(
        extractUserIdFromSharedText(
          `https://example.com/user/${CLERK_ID}`,
          null,
        ),
      ).toBeNull();
    });

    it("引数省略時は EXPO_PUBLIC_WEB_URL 未設定でも本番ホストを既定にする", () => {
      const saved = process.env.EXPO_PUBLIC_WEB_URL;
      delete process.env.EXPO_PUBLIC_WEB_URL;
      try {
        expect(
          extractUserIdFromSharedText(`${WEB_BASE}/user/${CLERK_ID}`),
        ).toBe(CLERK_ID);
      } finally {
        if (saved === undefined) {
          delete process.env.EXPO_PUBLIC_WEB_URL;
        } else {
          process.env.EXPO_PUBLIC_WEB_URL = saved;
        }
      }
    });
  });
});
