// イベント（issue #411）の frontmatter → events 行の変換。
// frontmatter 付き Markdown を D1 に投入するスクリプト群の共有部品
// （frontmatter-content.mjs）の上に乗る、イベント固有の検証・マッピング。
// 使い方の例は publish-event.mjs を参照。

import {
  frontmatterDateToUnix,
  frontmatterRequiredString,
} from "./frontmatter-content.mjs";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// 省略可の文字列 frontmatter 値を取り出す。未指定・null は null、
// 文字列でない値が来たらエラー（YAML で数値化した typo を黙って
// 登録しないため）。
function frontmatterOptionalString(value, { field }) {
  if (value === undefined || value === null) return null;
  return frontmatterRequiredString(value, { field });
}

/**
 * 検証済み frontmatter と本文から events テーブルの行（created_at /
 * updated_at を除く）を組み立てる。不正な値は Error を投げる。
 * @param {Record<string, unknown>} attributes パース済み frontmatter
 * @param {string} body frontmatter 以降の本文 Markdown
 * @returns {Record<string, string | number | null>}
 */
export function buildEventRow(attributes, body) {
  const slug = frontmatterRequiredString(attributes.slug, { field: "slug" });
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `slug の形式が正しくありません: ${slug}（小文字英数字とハイフンのみ、先頭は英数字）`,
    );
  }
  const title = frontmatterRequiredString(attributes.title, {
    field: "title",
  });
  const startsAt = frontmatterDateToUnix(attributes.starts_at, {
    field: "starts_at",
    required: true,
  });
  const endsAt = frontmatterDateToUnix(attributes.ends_at, {
    field: "ends_at",
    required: true,
  });
  if (endsAt <= startsAt) {
    throw new Error("ends_at は starts_at より後の日時にしてください");
  }
  const publishedAt = frontmatterDateToUnix(attributes.published_at, {
    field: "published_at",
    required: true,
  });
  const unpublishedAt = frontmatterDateToUnix(attributes.unpublished_at, {
    field: "unpublished_at",
  });
  if (unpublishedAt !== null && unpublishedAt <= publishedAt) {
    throw new Error(
      "unpublished_at は published_at より後の日時にしてください",
    );
  }

  return {
    slug,
    title,
    // 説明文は省略可（日程・会場だけの登録を許す）。空本文は NULL。
    body: body.trim() === "" ? null : body,
    cover_image_url: frontmatterOptionalString(attributes.cover_image_url, {
      field: "cover_image_url",
    }),
    location: frontmatterOptionalString(attributes.location, {
      field: "location",
    }),
    official_url: frontmatterOptionalString(attributes.official_url, {
      field: "official_url",
    }),
    starts_at: startsAt,
    ends_at: endsAt,
    published_at: publishedAt,
    unpublished_at: unpublishedAt,
  };
}
