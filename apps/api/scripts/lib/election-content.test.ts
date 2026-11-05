import { describe, it, expect } from "vitest";
import { buildElectionRows } from "./election-content.mjs";

// 総選挙投入（issue #438）の frontmatter → elections / election_candidates
// 行の変換。publish-election.mjs の検証ロジックをここで検証する。

const ISO = {
  starts: "2026-11-10T10:00:00+09:00",
  ends: "2026-11-20T18:00:00+09:00",
  published: "2026-11-01T09:00:00+09:00",
  unpublished: "2026-12-01T00:00:00+09:00",
};

const validAttributes = {
  slug: "megane-2026",
  title: "みんなが推す眼鏡キャラ総選挙",
  starts_at: ISO.starts,
  ends_at: ISO.ends,
  published_at: ISO.published,
  candidates: [
    { kind: "character", annict_id: 1234, name: "キャラA" },
    { kind: "character", annict_id: 5678, name: "キャラB" },
  ],
};

const unix = (s: string) => Math.floor(Date.parse(s) / 1000);

describe("buildElectionRows", () => {
  it("必須項目と省略項目を elections / election_candidates 行に変換する", () => {
    const { election, candidates } = buildElectionRows(
      validAttributes,
      "\n# 本文\n",
    );
    expect(election).toEqual({
      slug: "megane-2026",
      title: "みんなが推す眼鏡キャラ総選挙",
      body: "\n# 本文\n",
      cover_image_url: null,
      starts_at: unix(ISO.starts),
      ends_at: unix(ISO.ends),
      published_at: unix(ISO.published),
      unpublished_at: null,
    });
    expect(candidates).toEqual([
      {
        kind: "character",
        annict_id: 1234,
        name: "キャラA",
        image_url: null,
        position: 0,
      },
      {
        kind: "character",
        annict_id: 5678,
        name: "キャラB",
        image_url: null,
        position: 1,
      },
    ]);
  });

  it("省略項目の frontmatter 値を拾う", () => {
    const { election, candidates } = buildElectionRows(
      {
        ...validAttributes,
        cover_image_url: "https://example.com/c.png",
        unpublished_at: ISO.unpublished,
        candidates: [
          {
            kind: "work",
            annict_id: 100,
            name: "作品A",
            image_url: "https://example.com/a.png",
          },
          { kind: "work", annict_id: 200, name: "作品B" },
        ],
      },
      "説明",
    );
    expect(election).toMatchObject({
      cover_image_url: "https://example.com/c.png",
      unpublished_at: unix(ISO.unpublished),
    });
    expect(candidates[0]).toMatchObject({
      kind: "work",
      image_url: "https://example.com/a.png",
    });
  });

  it("本文が空なら body は null", () => {
    const { election } = buildElectionRows(validAttributes, "   \n\n");
    expect(election.body).toBeNull();
  });

  it("slug の形式が不正ならエラー", () => {
    expect(() =>
      buildElectionRows({ ...validAttributes, slug: "BAD_SLUG" }, "本文"),
    ).toThrow(/slug/);
    expect(() =>
      buildElectionRows({ ...validAttributes, slug: "-abc" }, "本文"),
    ).toThrow(/slug/);
  });

  it("必須項目が無いとエラー", () => {
    for (const field of [
      "title",
      "starts_at",
      "ends_at",
      "published_at",
    ] as const) {
      const attrs = { ...validAttributes };
      delete attrs[field];
      expect(() => buildElectionRows(attrs, "本文")).toThrow(new RegExp(field));
    }
    expect(() =>
      buildElectionRows({ ...validAttributes, candidates: undefined }, "本文"),
    ).toThrow(/candidates/);
  });

  it("ends_at が starts_at 以下ならエラー", () => {
    expect(() =>
      buildElectionRows({ ...validAttributes, ends_at: ISO.starts }, "本文"),
    ).toThrow(/ends_at/);
  });

  it("unpublished_at が published_at 以下ならエラー", () => {
    expect(() =>
      buildElectionRows(
        { ...validAttributes, unpublished_at: ISO.published },
        "本文",
      ),
    ).toThrow(/unpublished_at/);
  });

  it("候補が 2 件未満ならエラー", () => {
    expect(() =>
      buildElectionRows({ ...validAttributes, candidates: [] }, "本文"),
    ).toThrow(/candidates/);
    expect(() =>
      buildElectionRows(
        {
          ...validAttributes,
          candidates: [{ kind: "character", annict_id: 1, name: "A" }],
        },
        "本文",
      ),
    ).toThrow(/candidates/);
  });

  it("kind は character | work 以外を拒否する", () => {
    expect(() =>
      buildElectionRows(
        {
          ...validAttributes,
          candidates: [
            { kind: "staff", annict_id: 1, name: "A" },
            { kind: "character", annict_id: 2, name: "B" },
          ],
        },
        "本文",
      ),
    ).toThrow(/kind/);
  });

  it("annict_id は正の整数以外を拒否する", () => {
    for (const bad of [0, -1, 1.5, "1234"]) {
      expect(() =>
        buildElectionRows(
          {
            ...validAttributes,
            candidates: [
              { kind: "character", annict_id: bad, name: "A" },
              { kind: "character", annict_id: 2, name: "B" },
            ],
          },
          "本文",
        ),
      ).toThrow(/annict_id/);
    }
  });

  it("name の無い候補はエラー", () => {
    expect(() =>
      buildElectionRows(
        {
          ...validAttributes,
          candidates: [
            { kind: "character", annict_id: 1 },
            { kind: "character", annict_id: 2, name: "B" },
          ],
        },
        "本文",
      ),
    ).toThrow(/name/);
  });

  it("kind と annict_id の組が重複する候補はエラー", () => {
    expect(() =>
      buildElectionRows(
        {
          ...validAttributes,
          candidates: [
            { kind: "character", annict_id: 1, name: "A" },
            { kind: "character", annict_id: 1, name: "同じ候補" },
          ],
        },
        "本文",
      ),
    ).toThrow(/重複/);
    // kind が違えば同じ annict_id でも候補としては別物なので通す
    expect(() =>
      buildElectionRows(
        {
          ...validAttributes,
          candidates: [
            { kind: "character", annict_id: 1, name: "A" },
            { kind: "work", annict_id: 1, name: "B" },
          ],
        },
        "本文",
      ),
    ).not.toThrow();
  });

  it("cover_image_url と候補の image_url は https:// 以外を拒否する", () => {
    expect(() =>
      buildElectionRows(
        { ...validAttributes, cover_image_url: "http://example.com/" },
        "本文",
      ),
    ).toThrow(/cover_image_url/);
    expect(() =>
      buildElectionRows(
        {
          ...validAttributes,
          candidates: [
            {
              kind: "character",
              annict_id: 1,
              name: "A",
              image_url: "javascript:alert(1)",
            },
            { kind: "character", annict_id: 2, name: "B" },
          ],
        },
        "本文",
      ),
    ).toThrow(/image_url/);
  });
});
