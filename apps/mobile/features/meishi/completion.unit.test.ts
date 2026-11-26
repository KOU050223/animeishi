import { describe, expect, it } from "vitest";
import {
  isMeishiComplete,
  missingMeishiCompletionSteps,
  MEISHI_REQUIRED_FAVORITES,
  type MeishiCompletionInput,
} from "./completion";

const completeInput: MeishiCompletionInput = {
  profileImageUrl: "https://example.com/avatar.webp",
  username: "たろう",
  favoritesCount: MEISHI_REQUIRED_FAVORITES,
  document: {
    version: 1,
    canvas: {
      aspectRatio: 1.6,
      background: { kind: "solid", color: "#ffffff" },
    },
    elements: [],
  },
};

describe("missingMeishiCompletionSteps", () => {
  it("4 点が揃っていれば完成（missing は空）", () => {
    expect(missingMeishiCompletionSteps(completeInput)).toEqual([]);
    expect(isMeishiComplete(completeInput)).toBe(true);
  });

  it("アイコン未設定は avatar が未達", () => {
    for (const profileImageUrl of [null, undefined, "", "  "]) {
      expect(
        missingMeishiCompletionSteps({ ...completeInput, profileImageUrl }),
      ).toContain("avatar");
    }
  });

  it("表示名が空なら displayName が未達", () => {
    for (const username of [null, undefined, "", "  "]) {
      expect(
        missingMeishiCompletionSteps({ ...completeInput, username }),
      ).toContain("displayName");
    }
  });

  it("推しが規定数未満なら favorites が未達", () => {
    expect(
      missingMeishiCompletionSteps({
        ...completeInput,
        favoritesCount: MEISHI_REQUIRED_FAVORITES - 1,
      }),
    ).toEqual(["favorites"]);
    expect(
      isMeishiComplete({
        ...completeInput,
        favoritesCount: MEISHI_REQUIRED_FAVORITES + 2,
      }),
    ).toBe(true);
  });

  it("ドキュメント未作成なら template が未達", () => {
    for (const document of [null, undefined]) {
      expect(
        missingMeishiCompletionSteps({ ...completeInput, document }),
      ).toEqual(["template"]);
    }
  });

  it("複数未達は列挙順（アイコン→表示名→推し→テンプレート）で返す", () => {
    expect(
      missingMeishiCompletionSteps({
        profileImageUrl: null,
        username: null,
        favoritesCount: 0,
        document: null,
      }),
    ).toEqual(["avatar", "displayName", "favorites", "template"]);
  });
});
