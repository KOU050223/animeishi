import { describe, it, expect } from "vitest";
import {
  buildUpsertSql,
  frontmatterDateToUnix,
  frontmatterRequiredString,
  parseFrontmatterDocument,
  sqlLiteral,
} from "./frontmatter-content.mjs";

// frontmatter 付き Markdown → D1 upsert の共有部品（issue #437）。
// publish-article.mjs とイベント投入（publish-event.mjs、#411）が使うため、
// パース・SQL 生成の振る舞いをここで検証する。

describe("parseFrontmatterDocument", () => {
  it("frontmatter と本文を分解する", () => {
    const { attributes, body } = parseFrontmatterDocument(
      "---\nslug: test\ntitle: テスト\n---\n\n# 本文\n\n内容です\n",
    );
    expect(attributes).toMatchObject({ slug: "test", title: "テスト" });
    expect(body).toBe("\n# 本文\n\n内容です\n");
  });

  it("frontmatter が無いファイルはエラー", () => {
    expect(() => parseFrontmatterDocument("# ただの Markdown\n")).toThrow(
      /frontmatter/,
    );
  });

  it("frontmatter がキー: 値 でない場合はエラー", () => {
    expect(() =>
      parseFrontmatterDocument("---\n- a\n- b\n---\n本文\n"),
    ).toThrow(/キー: 値/);
  });

  it("BOM つきのファイルでも先頭の frontmatter を拾う", () => {
    const { attributes } = parseFrontmatterDocument(
      "\uFEFF---\nslug: test\n---\n本文\n",
    );
    expect(attributes.slug).toBe("test");
  });
});

describe("sqlLiteral", () => {
  it("文字列の単一引用符を二重化する", () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
  });

  it("null / undefined は NULL", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
  });

  it("数値はそのまま", () => {
    expect(sqlLiteral(1700000000)).toBe("1700000000");
  });

  it("有限でない数値はエラー", () => {
    expect(() => sqlLiteral(NaN)).toThrow();
  });
});

describe("buildUpsertSql", () => {
  it("conflict 列以外を UPDATE する upsert を組み立てる", () => {
    const sql = buildUpsertSql({
      table: "articles",
      conflictColumns: ["slug"],
      keepOnUpdate: ["created_at"],
      row: {
        slug: "s1",
        title: "タイトル",
        body: "本文'引用'あり",
        cover_image_url: null,
        created_at: 100,
        updated_at: 200,
      },
    });
    expect(sql).toBe(
      "INSERT INTO `articles` (`slug`, `title`, `body`, `cover_image_url`, `created_at`, `updated_at`) " +
        "VALUES ('s1', 'タイトル', '本文''引用''あり', NULL, 100, 200) " +
        "ON CONFLICT (`slug`) DO UPDATE SET `title` = excluded.`title`, " +
        "`body` = excluded.`body`, `cover_image_url` = excluded.`cover_image_url`, " +
        "`updated_at` = excluded.`updated_at`;",
    );
  });
});

describe("frontmatterDateToUnix", () => {
  it("ISO 8601 文字列を unixepoch 秒にする", () => {
    expect(
      frontmatterDateToUnix("2026-11-10T00:00:00+09:00", {
        field: "published_at",
      }),
    ).toBe(Math.floor(Date.parse("2026-11-10T00:00:00+09:00") / 1000));
  });

  it("YAML の Date オブジェクトも受け付ける", () => {
    const date = new Date("2026-11-10T00:00:00Z");
    expect(frontmatterDateToUnix(date, { field: "published_at" })).toBe(
      Math.floor(date.getTime() / 1000),
    );
  });

  it("省略可の空値は null", () => {
    expect(
      frontmatterDateToUnix(undefined, { field: "unpublished_at" }),
    ).toBeNull();
  });

  it("必須の空値はエラー", () => {
    expect(() =>
      frontmatterDateToUnix(undefined, {
        field: "published_at",
        required: true,
      }),
    ).toThrow(/published_at/);
  });

  it("解釈できない日時はエラー", () => {
    expect(() =>
      frontmatterDateToUnix("not a date", { field: "published_at" }),
    ).toThrow(/published_at/);
  });
});

describe("frontmatterRequiredString", () => {
  it("空文字・非文字列はエラー", () => {
    expect(() => frontmatterRequiredString("", { field: "title" })).toThrow(
      /title/,
    );
    expect(() => frontmatterRequiredString(123, { field: "title" })).toThrow(
      /title/,
    );
  });
});
