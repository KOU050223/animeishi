import { describe, it, expect } from "vitest";
import { buildMeishiPassJson } from "./buildPassJson";

describe("buildMeishiPassJson", () => {
  const base = {
    passTypeIdentifier: "pass.com.example.animeishi",
    teamIdentifier: "ABCDE12345",
    serialNumber: "user_123-1700000000000",
    username: "koh",
  };

  it("必須フィールドを含む pass.json を組み立てる", () => {
    const pass = buildMeishiPassJson(base);
    expect(pass.formatVersion).toBe(1);
    expect(pass.passTypeIdentifier).toBe(base.passTypeIdentifier);
    expect(pass.teamIdentifier).toBe(base.teamIdentifier);
    expect(pass.serialNumber).toBe(base.serialNumber);
    expect(pass.storeCard.primaryFields[0]).toMatchObject({
      key: "username",
      value: "koh",
    });
  });

  it("bio / favoriteQuote が無ければ対応フィールドを省く", () => {
    const pass = buildMeishiPassJson(base);
    expect(pass.storeCard.secondaryFields).toEqual([]);
    expect(pass.storeCard.auxiliaryFields).toEqual([]);
  });

  it("profileUrl があれば QR バーコードと裏面リンクを含める", () => {
    const pass = buildMeishiPassJson({
      ...base,
      profileUrl: "https://animeishi.example/u/koh",
    });
    expect(pass.barcodes?.[0]).toMatchObject({
      format: "PKBarcodeFormatQR",
      message: "https://animeishi.example/u/koh",
    });
    expect(pass.storeCard.backFields[0]).toMatchObject({
      key: "profileUrl",
      value: "https://animeishi.example/u/koh",
    });
  });

  it("profileUrl が無ければ barcodes を出力しない", () => {
    const pass = buildMeishiPassJson(base);
    expect(pass.barcodes).toBeUndefined();
  });
});
