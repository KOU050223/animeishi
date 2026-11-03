import { describe, expect, it } from "vitest";
import { parseQrPayload, parseUserIdFromQr } from "@/lib/qrParser";

// Clerk ID は user_ + base58。旧 Firebase UID は 28 文字英数字。
const CLERK_ID = "user_2abcDEF1234567890ghijKLMN";
const LEGACY_UID = "AbCdEf0123456789GhIjKlMnOpQr"; // 28 文字

describe("parseUserIdFromQr", () => {
  describe("生 UID フォーマット", () => {
    it("Clerk ID をそのまま抽出する", () => {
      expect(parseUserIdFromQr(CLERK_ID)).toBe(CLERK_ID);
    });

    it("旧 28 文字 UID をそのまま抽出する", () => {
      expect(parseUserIdFromQr(LEGACY_UID)).toBe(LEGACY_UID);
    });

    it("前後の空白を許容する", () => {
      expect(parseUserIdFromQr(`  ${CLERK_ID}  `)).toBe(CLERK_ID);
    });
  });

  describe("旧 URL フォーマット", () => {
    it("animeishi-viewer.web.app/user/{uid} から抽出する", () => {
      expect(
        parseUserIdFromQr(`https://animeishi-viewer.web.app/user/${CLERK_ID}`),
      ).toBe(CLERK_ID);
    });

    it("旧 UID を含む旧 URL からも抽出する", () => {
      expect(
        parseUserIdFromQr(
          `https://animeishi-viewer.web.app/user/${LEGACY_UID}`,
        ),
      ).toBe(LEGACY_UID);
    });

    it("ホストが変わっても /user/{uid} なら抽出する（将来の Web 版互換）", () => {
      expect(parseUserIdFromQr(`https://animeishi.app/user/${CLERK_ID}`)).toBe(
        CLERK_ID,
      );
    });

    it("本番 Web 版プロフィール URL から抽出する（QR 埋め込み形式）", () => {
      expect(
        parseUserIdFromQr(`https://animeishi.uomi.dev/user/${CLERK_ID}`),
      ).toBe(CLERK_ID);
    });

    it("クエリパラメータ・フラグメントを無視する", () => {
      expect(
        parseUserIdFromQr(`https://example.com/user/${CLERK_ID}?ref=qr#top`),
      ).toBe(CLERK_ID);
    });

    it("末尾スラッシュを許容する", () => {
      expect(parseUserIdFromQr(`https://example.com/user/${CLERK_ID}/`)).toBe(
        CLERK_ID,
      );
    });
  });

  describe("カスタムスキーム", () => {
    it("animeishi://user/{uid} から抽出する", () => {
      expect(parseUserIdFromQr(`animeishi://user/${CLERK_ID}`)).toBe(CLERK_ID);
    });

    it("animeishi://{uid} から抽出する", () => {
      expect(parseUserIdFromQr(`animeishi://${CLERK_ID}`)).toBe(CLERK_ID);
    });
  });

  describe("不正な入力", () => {
    it("null を返す: 空文字", () => {
      expect(parseUserIdFromQr("")).toBeNull();
    });

    it("null を返す: 空白のみ", () => {
      expect(parseUserIdFromQr("   ")).toBeNull();
    });

    it("null を返す: null/undefined", () => {
      expect(parseUserIdFromQr(null)).toBeNull();
      expect(parseUserIdFromQr(undefined)).toBeNull();
    });

    it("null を返す: UID 形式でないただの文字列", () => {
      expect(parseUserIdFromQr("hello world")).toBeNull();
    });

    it("null を返す: UID を含まない URL", () => {
      expect(parseUserIdFromQr("https://example.com/about")).toBeNull();
    });

    it("null を返す: 短すぎる UID", () => {
      expect(parseUserIdFromQr("user/abc123")).toBeNull();
    });

    it("null を返す: 記号を含む不正な値", () => {
      expect(
        parseUserIdFromQr("https://example.com/user/has space here"),
      ).toBeNull();
    });
  });
});

describe("parseQrPayload", () => {
  const TOKEN = "1730000000.AbCdEf-sig_nature";

  it("対面交換 QR（?qt= 付き）から userId とトークンを取り出す", () => {
    expect(
      parseQrPayload(`https://animeishi.uomi.dev/user/${CLERK_ID}?qt=${TOKEN}`),
    ).toEqual({ userId: CLERK_ID, qrToken: TOKEN });
  });

  it("animeishi:// スキームの ?qt= も取り出す", () => {
    expect(parseQrPayload(`animeishi://user/${CLERK_ID}?qt=${TOKEN}`)).toEqual({
      userId: CLERK_ID,
      qrToken: TOKEN,
    });
  });

  it("トークンが無い共有 URL は qrToken が undefined になる", () => {
    expect(
      parseQrPayload(`https://animeishi.uomi.dev/user/${CLERK_ID}`),
    ).toEqual({ userId: CLERK_ID, qrToken: undefined });
  });

  it("他のクエリパラメータがあっても qt だけを拾う", () => {
    expect(
      parseQrPayload(
        `https://animeishi.uomi.dev/user/${CLERK_ID}?ref=qr&qt=${TOKEN}#top`,
      ),
    ).toEqual({ userId: CLERK_ID, qrToken: TOKEN });
  });

  it("UID を抽出できない入力は null", () => {
    expect(parseQrPayload("https://example.com/about?qt=x")).toBeNull();
    expect(parseQrPayload(null)).toBeNull();
  });

  it("qt が不正なパーセントエンコードなら例外を投げず null を返す", () => {
    // decodeURIComponent が URIError を投げる入力。カメラコールバックで
    // クラッシュしないよう QR ごと無効扱いにする（CodeRabbit 指摘）。
    expect(
      parseQrPayload(`https://animeishi.uomi.dev/user/${CLERK_ID}?qt=%E0%A4%A`),
    ).toBeNull();
    expect(parseQrPayload(`animeishi://user/${CLERK_ID}?qt=%`)).toBeNull();
  });
});
