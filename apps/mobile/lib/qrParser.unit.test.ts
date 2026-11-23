import { describe, expect, it } from "vitest";
import {
  buildQrExchangeUrl,
  encodeMiniMeishi,
  parseQrPayload,
  parseUserIdFromQr,
} from "@/lib/qrParser";

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

  describe("オフライン交換パラメータ（issue #663/#680）", () => {
    const OFFLINE_TOKEN = "1760000000.OfFLiNe-sig_nature";

    it("?ot= 付き QR から offlineToken を取り出す", () => {
      expect(
        parseQrPayload(
          `https://animeishi.uomi.dev/user/${CLERK_ID}?ot=${OFFLINE_TOKEN}`,
        ),
      ).toEqual({
        userId: CLERK_ID,
        qrToken: undefined,
        offlineToken: OFFLINE_TOKEN,
        miniMeishi: undefined,
      });
    });

    it("qt と ot が併記されていても両方取り出す", () => {
      expect(
        parseQrPayload(
          `https://animeishi.uomi.dev/user/${CLERK_ID}?qt=${TOKEN}&ot=${OFFLINE_TOKEN}`,
        ),
      ).toEqual({
        userId: CLERK_ID,
        qrToken: TOKEN,
        offlineToken: OFFLINE_TOKEN,
        miniMeishi: undefined,
      });
    });

    it("ot の値が不正なパーセントエンコードでも QR は有効なままにする", () => {
      expect(
        parseQrPayload(
          `https://animeishi.uomi.dev/user/${CLERK_ID}?qt=${TOKEN}&ot=%`,
        ),
      ).toEqual({
        userId: CLERK_ID,
        qrToken: TOKEN,
        offlineToken: undefined,
        miniMeishi: undefined,
      });
    });

    it("?mc= のミニ名刺をデコードする（日本語ユーザ名を含む）", () => {
      const mc = encodeMiniMeishi({
        username: "会場たろう",
        avatarUrl: "https://img.example/avatar.webp",
      });
      expect(mc).not.toBeNull();
      const payload = parseQrPayload(
        `https://animeishi.uomi.dev/user/${CLERK_ID}?ot=${OFFLINE_TOKEN}&mc=${mc}`,
      );
      expect(payload).toEqual({
        userId: CLERK_ID,
        qrToken: undefined,
        offlineToken: OFFLINE_TOKEN,
        miniMeishi: {
          username: "会場たろう",
          avatarUrl: "https://img.example/avatar.webp",
        },
      });
    });

    it("mc が壊れていても QR は有効なままにする", () => {
      const payload = parseQrPayload(
        `https://animeishi.uomi.dev/user/${CLERK_ID}?qt=${TOKEN}&mc=not-base64!!!`,
      );
      expect(payload?.userId).toBe(CLERK_ID);
      expect(payload?.qrToken).toBe(TOKEN);
      expect(payload?.miniMeishi).toBeUndefined();
    });

    it("mc が JSON でもオブジェクトでもない値なら miniMeishi は undefined", () => {
      // base64url("42") → オブジェクトでない JSON
      const mc = encodeURIComponent(
        btoa("42").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
      );
      const payload = parseQrPayload(
        `https://animeishi.uomi.dev/user/${CLERK_ID}?mc=${mc}`,
      );
      expect(payload?.miniMeishi).toBeUndefined();
    });

    it("旧形式（トークン無し・qt のみ）の QR も従来どおり読める", () => {
      expect(
        parseQrPayload(`https://animeishi.uomi.dev/user/${CLERK_ID}`),
      ).toEqual({
        userId: CLERK_ID,
        qrToken: undefined,
        offlineToken: undefined,
        miniMeishi: undefined,
      });
    });
  });
});

describe("encodeMiniMeishi", () => {
  it("username と avatarUrl を JSON→base64url にエンコードする", () => {
    const encoded = encodeMiniMeishi({
      username: "たろう",
      avatarUrl: "https://img.example/a.webp",
    });
    // base64url に使えない文字が出ないこと + 復号で元に戻ること。
    expect(encoded).toMatch(/^[0-9A-Za-z_-]+$/);
    const bin = atob((encoded ?? "").replace(/-/g, "+").replace(/_/g, "/"));
    expect(JSON.parse(decodeURIComponent(escape(bin)))).toEqual({
      username: "たろう",
      avatarUrl: "https://img.example/a.webp",
    });
  });

  it("avatarUrl が無くても username だけでエンコードする", () => {
    const encoded = encodeMiniMeishi({ username: "たろう" });
    const bin = atob((encoded ?? "").replace(/-/g, "+").replace(/_/g, "/"));
    expect(JSON.parse(decodeURIComponent(escape(bin)))).toEqual({
      username: "たろう",
    });
  });

  it("username も avatarUrl も無ければ null", () => {
    expect(encodeMiniMeishi({})).toBeNull();
    expect(
      encodeMiniMeishi({ username: undefined, avatarUrl: undefined }),
    ).toBeNull();
  });
});

describe("buildQrExchangeUrl", () => {
  const SHARE_URL = `https://animeishi.uomi.dev/user/${CLERK_ID}`;
  const QT = "1730000000.sig_qt";
  const OT = "1760000000.sig_ot";

  it("qt があれば ?qt= と &mc= を付ける", () => {
    const url = buildQrExchangeUrl(SHARE_URL, {
      qt: QT,
      miniMeishi: { username: "たろう" },
    });
    expect(url).toContain("?qt=");
    expect(url).toContain("&mc=");
    // 表示側の QR と読み取り側のパーサーでラウンドトリップできる。
    expect(parseQrPayload(url)).toEqual({
      userId: CLERK_ID,
      qrToken: QT,
      offlineToken: undefined,
      miniMeishi: { username: "たろう" },
    });
  });

  it("qt が無く ot があれば ?ot= にフォールバックする", () => {
    const url = buildQrExchangeUrl(SHARE_URL, {
      ot: OT,
      miniMeishi: { username: "たろう" },
    });
    expect(url).toContain("?ot=");
    expect(url).not.toContain("qt=");
    expect(parseQrPayload(url)?.offlineToken).toBe(OT);
  });

  it("qt があればキャッシュ済みの ot は載せない（フォールバック併記）", () => {
    const url = buildQrExchangeUrl(SHARE_URL, {
      qt: QT,
      ot: OT,
      miniMeishi: { username: "たろう" },
    });
    expect(url).toContain("?qt=");
    expect(url).not.toContain("ot=");
  });

  it("近づけて交換用（includeOfflineWithQt）は qt と ot を両方載せ、パーサーで両方取り出せる", () => {
    const url = buildQrExchangeUrl(SHARE_URL, {
      qt: QT,
      ot: OT,
      miniMeishi: { username: "たろう" },
      includeOfflineWithQt: true,
    });
    expect(parseQrPayload(url)).toEqual({
      userId: CLERK_ID,
      qrToken: QT,
      offlineToken: OT,
      miniMeishi: { username: "たろう" },
    });
  });

  it("qt も ot も無ければ shareUrl をそのまま返す", () => {
    expect(
      buildQrExchangeUrl(SHARE_URL, { miniMeishi: { username: "たろう" } }),
    ).toBe(SHARE_URL);
  });

  it("ミニ名刺が空なら mc は付けない", () => {
    const url = buildQrExchangeUrl(SHARE_URL, { qt: QT, miniMeishi: {} });
    expect(url).toBe(`${SHARE_URL}?qt=${encodeURIComponent(QT)}`);
  });
});
