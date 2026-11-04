import { describe, it, expect } from "vitest";
import { buildEventRow } from "./event-content.mjs";

// イベント投入（issue #411）の frontmatter → events 行の変換。
// publish-event.mjs の検証ロジックをここで検証する。

const ISO = {
  starts: "2026-11-10T10:00:00+09:00",
  ends: "2026-11-11T18:00:00+09:00",
  published: "2026-11-01T09:00:00+09:00",
  unpublished: "2026-11-20T00:00:00+09:00",
};

const validAttributes = {
  slug: "comiket-107",
  title: "コミックマーケット107",
  starts_at: ISO.starts,
  ends_at: ISO.ends,
  published_at: ISO.published,
};

const unix = (s: string) => Math.floor(Date.parse(s) / 1000);

describe("buildEventRow", () => {
  it("必須項目と省略項目を events 行に変換する", () => {
    const row = buildEventRow(validAttributes, "\n# 本文\n");
    expect(row).toEqual({
      slug: "comiket-107",
      title: "コミックマーケット107",
      body: "\n# 本文\n",
      cover_image_url: null,
      location: null,
      official_url: null,
      starts_at: unix(ISO.starts),
      ends_at: unix(ISO.ends),
      published_at: unix(ISO.published),
      unpublished_at: null,
    });
  });

  it("省略項目の frontmatter 値を拾う", () => {
    const row = buildEventRow(
      {
        ...validAttributes,
        cover_image_url: "https://example.com/c.png",
        location: "東京ビッグサイト",
        official_url: "https://example.com/",
        unpublished_at: ISO.unpublished,
      },
      "説明",
    );
    expect(row).toMatchObject({
      cover_image_url: "https://example.com/c.png",
      location: "東京ビッグサイト",
      official_url: "https://example.com/",
      unpublished_at: unix(ISO.unpublished),
    });
  });

  it("本文が空なら body は null", () => {
    const row = buildEventRow(validAttributes, "   \n\n");
    expect(row.body).toBeNull();
  });

  it("slug の形式が不正ならエラー", () => {
    expect(() =>
      buildEventRow({ ...validAttributes, slug: "BAD_SLUG" }, "本文"),
    ).toThrow(/slug/);
    expect(() =>
      buildEventRow({ ...validAttributes, slug: "-abc" }, "本文"),
    ).toThrow(/slug/);
  });

  it("必須項目（title・starts_at・ends_at・published_at）が無いとエラー", () => {
    for (const field of [
      "title",
      "starts_at",
      "ends_at",
      "published_at",
    ] as const) {
      const attrs = { ...validAttributes };
      delete attrs[field];
      expect(() => buildEventRow(attrs, "本文")).toThrow(new RegExp(field));
    }
  });

  it("ends_at が starts_at 以下ならエラー", () => {
    expect(() =>
      buildEventRow({ ...validAttributes, ends_at: ISO.starts }, "本文"),
    ).toThrow(/ends_at/);
  });

  it("unpublished_at が published_at 以下ならエラー", () => {
    expect(() =>
      buildEventRow(
        { ...validAttributes, unpublished_at: ISO.published },
        "本文",
      ),
    ).toThrow(/unpublished_at/);
  });

  it("文字列でない省略項目はエラー", () => {
    expect(() =>
      buildEventRow({ ...validAttributes, location: 123 }, "本文"),
    ).toThrow(/location/);
  });

  it("official_url・cover_image_url は https:// 以外を拒否する", () => {
    // アプリから開く・画像として読む URL のため https のみ許可する。
    for (const field of ["official_url", "cover_image_url"] as const) {
      expect(() =>
        buildEventRow(
          { ...validAttributes, [field]: "http://example.com/" },
          "本文",
        ),
      ).toThrow(new RegExp(field));
      expect(() =>
        buildEventRow(
          { ...validAttributes, [field]: "javascript:alert(1)" },
          "本文",
        ),
      ).toThrow(new RegExp(field));
      // https は通る
      expect(() =>
        buildEventRow(
          { ...validAttributes, [field]: "https://example.com/" },
          "本文",
        ),
      ).not.toThrow();
    }
  });
});
